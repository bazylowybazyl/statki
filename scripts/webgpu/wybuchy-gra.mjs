// Wybuchy WebGPU (src/3d/explosions/) w PRAWDZIWEJ grze: Vite + headless Chrome z WebGPU (CDP), czas wirtualny harnessu
// (scripts/webgpu/harness-strona.js — klatka = 1/60 s, zrzuty na zatrzymanej klatce).
//
//   node scripts/webgpu/wybuchy-gra.mjs [--sceny prog,lancuch,stacja,pustka] [--out .tmp/wybuchy-gra] [--rozmiar 1600x900]
//        [--port 5376] [--koszt [--kosztSwiatla | --kosztPrzeszkody]] [--ab klucz] [--gpu [regex kadrów]] [--przeszkody 0]
//
// Sceny (misja 1, skok dev ?story=ram — suchy dok postawiony):
//   prog    — próg punktów doku: trafienie w odcinek trzonu (lastHit + applyDamageToStation 1/8 punktów) → kawałek
//             odpada jako ciało i wybucha (onDryDockDamageStep → window.makeReactorBlow),
//   lancuch — śmierć doku i łańcuch rozpadu misji (StoryGame._chainExplosion: ~15 wybuchów w ~4 s + finał w hali),
//   stacja  — rozpad stacji planety (Wenus: applyDamageToStation do zera → Destruction3D → reactorFactory),
//   pustka  — śmierć gracza bez rdzenia (triggerReactorBlow3D, size 282) w pustej przestrzeni,
//   dysze   — wybuch za rufą Atlasa na pełnym ciągu (dopalacz): światła dysz w dymie (etap B — siatka świateł w gazie),
//   maszt   — wybuch przy maszcie reflektorów parkingu doku (światło masztu w dymie),
//   pas     — wybuch w gęstym polu pasa asteroid (strefa nieba: ciemniejsze otoczenie, mrok pola).
// --ab gridLight — A/B tej samej klatki bez świateł siatki w dymie. --gpu [regex]: na zatrzymanej klatce (wybuch stoi)
// mediana czasu GPU klatki ze światłami siatki w dymie i bez, naprzemiennie (koszt marszu z pętlą świateł).
// --koszt --kosztSwiatla: łańcuch w czasie rzeczywistym z gazem ze światłami siatki i bez, naprzemiennie.
// --koszt: łańcuch rozpadu w czasie rzeczywistym — czasy klatek (średnia, p95, najgorsza), domeny gazu, CPU kroku; ten
// sam przebieg z gazem i bez (wybuchy z cząstek) i bez wybuchów, oraz A/B fizyki gazu sprzed etapu A (naprzemiennie).
// Raport: <out>/raport.json — liczniki wybuchów, pipeline'y SYNCHRONICZNE w klatkach scen (ma być 0), błędy konsoli.
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const sceny = String(args.sceny || 'prog,lancuch,stacja,pustka').split(',');
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/wybuchy-gra');
mkdirSync(out, { recursive: true });
const kvArg = (str) => Object.fromEntries(String(str || '').split(',').filter(Boolean).map((p) => {
  const [k, v] = p.split('='); return [k, v === 'true' ? true : v === 'false' ? false : Number(v)];
}));
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
  return { spawned: s.spawned, gas: s.gas, particles: s.particles, off: s.off, merged: s.merged, inh: s.inherited, rel: s.relaxed ?? null, noSlot: s.noSlot, sec: s.secondaries,
    domeny: x.grid.stats.active, fine: s.fineDomains ?? null, coarse: s.coarseDomains ?? null, pamMB: x.grid.memoryBytes != null ? +(x.grid.memoryBytes / 1e6).toFixed(1) : null, zrodla: x.grid.stats.sources, zar: x.embers.stats.alive, odlamki: x.fN, cpu: +s.cpuMs.toFixed(2), swiatla: s.lights,
    ob: { pudla: x.grid._boxN, obrysy: x.grid._footN, zBrylami: x.grid.stats.masked, kadluby: x.grid.stats.hulls, przesuniete: s.moved, wScianie: x.director.stats.blocked } };
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

// Koszt marszu z pętlą świateł: ta sama zatrzymana klatka (zegar gry stoi, klatki lecą), mediana Core3D.gpuFrameMs ze
// światłami siatki w dymie i bez, naprzemiennie ABBA (zegar GPU zwraca wynik z opóźnieniem — próbki po 0,5 s od zmiany).
const GPU_KEY = String(args.gpuKlucz || 'gridLight');   // przełącznik reżysera w A/B kosztu GPU
const gpuAB = (rounds = 2, ms = 1300) => ev(`(async () => {
  const X = window.__explosions, h = window.__harness, C = window.Core3D;
  h.hold(false);
  const med = async () => { const r = []; const t0 = h.realNow();
    while (h.realNow() - t0 < ${ms}) { await new Promise((q) => setTimeout(q, 40)); const g = C.gpuFrameMs; if (g > 0) r.push(g); }
    r.sort((a, b) => a - b); return r.length ? r[r.length >> 1] : null; };
  const on = [], off = [];
  for (let i = 0; i < ${rounds}; i++) for (const st of (i % 2 ? [false, true] : [true, false])) {
    X.tune['${GPU_KEY}'] = st; await new Promise((q) => setTimeout(q, 500)); (st ? on : off).push(await med());
  }
  X.tune['${GPU_KEY}'] = true; h.hold(true);
  const m = (a) => { const v = a.filter((x) => x != null).sort((p, q) => p - q); return v.length ? +v[v.length >> 1].toFixed(3) : null; };
  return { klucz: '${GPU_KEY}', gpuZ: m(on), gpuBez: m(off), roznica: m(on) != null && m(off) != null ? +(m(on) - m(off)).toFixed(3) : null,
    swiatlaSiatki: C.fx?.stats?.lights ?? null, domeny: X.grid.stats.active };
})()`, 120000);
const WARIANTY = args.warianty ? String(args.warianty).split('|').map((w) => {
  const [name, body = ''] = w.split('@');
  return { name, set: body.split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; }) };
}) : [];
const gpuRe = args.gpu ? new RegExp(args.gpu === '1' ? '.' : String(args.gpu)) : null;

async function shot(name, n) {
  if (n > 0) await ev(`window.__harness.step(${n})`);
  await ev('window.__harness.frames(2)');
  await sleep(80);
  await screenshotPng(cdp, join(out, `${name}.png`));
  // --ab klucz[,klucz…]: każdy przełącznik reżysera osobno (false → zrzut → przywrócenie wartości).
  for (const key of args.ab ? String(args.ab).split(',') : []) {
    await ev(`(async () => { const T = window.__explosions.tune; window.__abPrev = T['${key}']; T['${key}'] = false; await window.__harness.frames(2); return true; })()`);
    await sleep(80);
    await screenshotPng(cdp, join(out, `${name}-bez-${key}.png`));
    await ev(`(async () => { window.__explosions.tune['${key}'] = window.__abPrev; await window.__harness.frames(1); return true; })()`);
  }
  // --warianty 'nazwa@look.k=v,gaz.k=v|…' — ta sama zatrzymana klatka ze strojeniem obrazu (volume.look) albo gazu
  // (grid.tune; objętość światła liczy się co klatkę), potem powrót do wartości gry.
  for (const w of WARIANTY) {
    await ev(`(async () => { const X = window.__explosions, W = ${JSON.stringify(w.set)}; window.__wPrev = [];
      for (const [k, v] of W) { const [o, key] = k.split('.'); const T = o === 'look' ? X.volume.look : X.grid.tune; window.__wPrev.push([T, key, T[key]]); T[key] = v; }
      if (W.some(([k]) => k === 'gaz.glowFar')) X._glowFar = X.grid.tune.glowFar;
      await window.__harness.frames(2); return true; })()`);
    await sleep(80);
    await screenshotPng(cdp, join(out, `${name}-w-${w.name}.png`));
    await ev(`(async () => { for (const [T, key, v] of window.__wPrev) T[key] = v; const X = window.__explosions; X._glowFar = X.grid.tune.glowFar; await window.__harness.frames(1); return true; })()`);
  }
  const st = await stats();
  if (gpuRe && gpuRe.test(name) && st && st.domeny > 0) st.gpu = await gpuAB();
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
  // --siatka k=v,… — konfiguracja siatek gazu przed startem gry (window.__EXPLOSION_GRID, np. slots=10,fineSlots=0 — dawne
  // 10 domen bez atlasu „fine”); --tune k=v,… — EXPLOSION_TUNE po starcie (np. domainScale=5.4).
  const GRID_OVR = args.siatka ? `window.__EXPLOSION_GRID = ${JSON.stringify(kvArg(args.siatka))};\n` : '';
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${GRID_OVR}${INJECT}` });
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
  // --przeszkody 0: gaz bez przeszkód (etap C — A/B łańcucha i scen niszczących dok na świeżej stronie)
  if (String(args.przeszkody) === '0') await ev('(() => { const X = window.__explosions; X.tune.obstacles = false; X.tune.hullObstacles = false; return true; })()');
  if (args.tune) await ev(`(() => { Object.assign(window.__explosions.tune, ${JSON.stringify(kvArg(args.tune))}); return true; })()`);
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

  if (sceny.includes('dysze')) {
    // Atlas w pustce na pełnym ciągu z dopalaczem; wybuch (cruiser, jak zbiornik niszczyciela) ~700 j. za rufą.
    const k0 = await frameK();
    const g = await ev('(() => { const S = window.StoryGame, d = S.site.dock, l = d.layout; const p = d.toGame(4000, l.bounds.z1 + 6000); return { x: p.x, y: p.y }; })()');
    await ev(`(() => { const S = window.StoryGame; S.deps.placePlayer(${g.x}, ${g.y}, 0); window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
    // Kamera statku (w trybie RTS klawisze W / Shift przesuwają kamerę zamiast dawać ciąg).
    const shipCam = (z) => ev(`(() => { const c = window.camera; c.mode = 'ship'; c.focusStation = null; c.transition = null; c.manualZoom = true;
      c.zoom = c.targetZoom = c.zoomBase = ${z}; document.getElementById('cockpit-ui-host')?.classList.add('hidden'); return true; })()`);
    await shipCam(0.32);
    const keyEv = (type, k, code, vk) => cdp.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
    await keyEv('keyDown', 'w', 'KeyW', 87);
    await keyEv('keyDown', 'Shift', 'ShiftLeft', 16);
    await ev('window.__harness.step(40)');
    const p = await ev('(() => { const s = window.ship; const a = s.angle; return { x: s.pos.x, y: s.pos.y, bx: s.pos.x - Math.cos(a) * 700, by: s.pos.y - Math.sin(a) * 700 }; })()');
    await shipCam(0.32);
    await ev(`(() => { window.makeReactorBlow({ x: ${p.bx}, y: ${p.by}, size: 140, profile: 'cruiser' }); return true; })()`);
    const rows = [];
    let tNow = 0;
    for (const at of [0.2, 0.6, 1.2, 2.0, 3.0]) {
      await ev(`window.__harness.step(${Math.round((at - tNow) * 60)})`);
      rows.push({ t: at, ...(await shot(`dysze-${String(at).replace('.', '_')}`, 0)), v: await ev('Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y))') });
      tNow = at;
    }
    await keyEv('keyUp', 'w', 'KeyW', 87);
    await keyEv('keyUp', 'Shift', 'ShiftLeft', 16);
    report.sceny.dysze = { rows, pipeline: await pipesSince(k0) };
    console.log('dysze pipeline', JSON.stringify(report.sceny.dysze.pipeline));
    await ev('(() => { window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()');
    await ev('window.__harness.step(240)');
  }

  if (sceny.includes('maszt')) {
    // Wybuch przy maszcie reflektorów parkingu (światło masztu w siatce — PirateDryDock3D.pushGridLights).
    const k0 = await frameK();
    const m = await ev(`(() => { const d = window.StoryGame.site.dock, L = d.layout.lights.find((q) => q.kind === 'flood') || d.layout.lights[0];
      const p = d.toGame(L.x, L.z), a = d.toGame(L.aim.x, L.aim.z); return { x: p.x, y: p.y, ax: a.x, ay: a.y }; })()`);
    const bx = m.x + (m.ax - m.x) * 0.55, by = m.y + (m.ay - m.y) * 0.55;
    await camAt((m.x + bx) / 2, (m.y + by) / 2, 0.3);
    await shot('maszt-0-przed', 2);
    await ev(`(() => { window.makeReactorBlow({ x: ${bx}, y: ${by}, size: 220 }); return true; })()`);
    const rows = [];
    let tNow = 0;
    for (const at of [0.3, 0.9, 1.6, 2.8, 4.0]) {
      rows.push({ t: at, ...(await shot(`maszt-${String(at).replace('.', '_')}`, Math.round((at - tNow) * 60))) });
      tNow = at;
    }
    report.sceny.maszt = { rows, pipeline: await pipesSince(k0) };
    console.log('maszt pipeline', JSON.stringify(report.sceny.maszt.pipeline));
    await ev('window.__harness.step(300)');
  }

  if (sceny.includes('pas')) {
    // Gęste pole pasa (miejsce z dema asteroid — to samo pole co gra): gracz i kamera w polu, strefa nieba „pas”.
    const k0 = await frameK();
    const at = await ev(`(async () => { const W = await import('/dema/asteroidy-webgpu/world.js'); const s = W.SPOTS.field;
      window.DevScene.teleport(s.x, s.y, -0.4); window.ship.vel.x = 0; window.ship.vel.y = 0; return { x: s.x, y: s.y }; })()`);
    await camAt(at.x + 1500, at.y, 0.3);
    await ev('window.__harness.step(400)');   // strefa nieba dochodzi do pasa (easeSec 1,5 s), pas buduje widok
    await camAt(at.x + 1500, at.y, 0.3);
    const sky = await ev('(() => window.getSkyRegion ? +window.getSkyRegion().toFixed(3) : null)()');
    console.log('pas: strefa nieba', sky);
    await shot('pas-0-przed', 2);
    await ev(`(() => { window.makeReactorBlow({ x: ${at.x + 1500}, y: ${at.y}, size: 200, profile: 'cruiser' }); return true; })()`);
    const rows = [];
    let tNow = 0;
    for (const t of [0.4, 1.2, 2.2, 3.4]) {
      rows.push({ t, ...(await shot(`pas-${String(t).replace('.', '_')}`, Math.round((t - tNow) * 60))) });
      tNow = t;
    }
    report.sceny.pas = { sky, rows, pipeline: await pipesSince(k0) };
    console.log('pas pipeline', JSON.stringify(report.sceny.pas.pipeline));
  }

  if (args.koszt) {
    // Czas rzeczywisty: nowa gra (dok cały), łańcuch rozpadu, próbki czasu klatki; z gazem, bez gazu, bez wybuchów.
    // gaz / rez: fizyka gazu i reżysera na czas przebiegu (A/B starej fizyki w tym samym przebiegu; null = obecna gry).
    await ev('(() => { const X = window.__explosions; window.__kosztBaza = { gaz: { ...X.grid.tune }, rez: { ...X.director.tune } }; return true; })()');
    const run = (label, tune, gaz = null, rez = null) => ev(`(async () => {
      const X = window.__explosions; Object.assign(X.tune, ${JSON.stringify(tune)}); X.clear();
      Object.assign(X.grid.tune, window.__kosztBaza.gaz, ${JSON.stringify(gaz || {})});
      Object.assign(X.director.tune, window.__kosztBaza.rez, ${JSON.stringify(rez || {})});
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
      const A = { cpu: 0, sim: 0, adv: 0, spawn: 0, maxSim: 0, maxAdv: 0, maxSpawn: 0, substeps: 0, obst: 0, maxObst: 0, rast: 0, maxRast: 0, game: 0, maxGame: 0, pack: 0, maxPack: 0 };
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
        // przeszkody (etap C): reżyser (wejście → scena + rastry statyki), w tym rastry, gra (pakowanie), siatka (_pack)
        const om = X.stats.obstMs || 0, rm = X.grid.stats.rasterMs || 0, gm = window.__gasObstStats?.ms || 0, pm = X.grid.stats.packMs || 0;
        A.obst += om; A.maxObst = Math.max(A.maxObst, om); A.rast += rm; A.maxRast = Math.max(A.maxRast, rm);
        A.game += gm; A.maxGame = Math.max(A.maxGame, gm); A.pack += pm; A.maxPack = Math.max(A.maxPack, pm);
      }
      h.clock.t = h.realNow(); h.clock.mode = 'frozen'; h.hold(true);
      dts.sort((a, b) => a - b);
      const q = (p) => +dts[Math.min(dts.length - 1, Math.floor(p * dts.length))].toFixed(2);
      const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
      return { label: '${label}', wybuchy: i, klatki: n, sredniaMs: +avg.toFixed(2), p50: q(0.5), p95: q(0.95), najgorszaMs: +worst.toFixed(1), maxDomen: maxDom,
        cpuKrokuMax: +cpu.toFixed(2), cpuKrokuSr: +(A.cpu / n).toFixed(3), simSr: +(A.sim / n).toFixed(3), simMax: +A.maxSim.toFixed(2),
        advSr: +(A.adv / n).toFixed(3), advMax: +A.maxAdv.toFixed(2), spawnMax: +A.maxSpawn.toFixed(2), podkrokiSr: +(A.substeps / n).toFixed(2),
        przeszkody: { rezSr: +(A.obst / n).toFixed(4), rezMax: +A.maxObst.toFixed(3), rastrySr: +(A.rast / n).toFixed(4), rastryMax: +A.maxRast.toFixed(3),
          graSr: +(A.game / n).toFixed(4), graMax: +A.maxGame.toFixed(3), siatkaSr: +(A.pack / n).toFixed(4), siatkaMax: +A.maxPack.toFixed(3) } };
    })()`);
    report.koszt = [];
    // Fizyka gazu sprzed etapu A (2026-10-08): bez MacCormacka prędkości, wiry 3,5, turbulencja 35, bez gąbki i kurczenia,
    // narzucenie źródeł przez całe życie — A/B kosztu naprzemiennie w tym samym przebiegu.
    const OLD_GAS = { velMacCormack: 0, vorticity: 3.5, turbulence: 35, sponge: 0, contraction: 0 };
    const OLD_REZ = { velTau: 0 };
    const G = { enabled: true, gas: true, gridLight: true };
    // Etap B: światła siatki w dymie — z gazem bez nich (gridLight false) naprzemiennie z pełnym.
    const NOL = { enabled: true, gas: true, gridLight: false };
    // Etap C: przeszkody gazu (statyka i kadłuby) — z gazem bez przeszkód naprzemiennie z pełnym.
    const GO = { enabled: true, gas: true, gridLight: true, obstacles: true, hullObstacles: true };
    const NOB = { enabled: true, gas: true, gridLight: true, obstacles: false, hullObstacles: false };
    const LIST = args.kosztPrzeszkody
      ? [['bez wybuchów', { enabled: false }], ['z gazem', GO], ['z gazem bez przeszkód', NOB], ['z gazem bez przeszkód (2)', NOB],
        ['z gazem (2)', GO], ['z gazem (3)', GO], ['z gazem bez przeszkód (3)', NOB], ['bez wybuchów (2)', { enabled: false }]]
      : args.kosztSwiatla
      ? [['bez wybuchów', { enabled: false }], ['z gazem', G], ['z gazem bez świateł siatki', NOL], ['z gazem bez świateł siatki (2)', NOL],
        ['z gazem (2)', G], ['z gazem (3)', G], ['z gazem bez świateł siatki (3)', NOL], ['bez wybuchów (2)', { enabled: false }]]
      : [['bez wybuchów', { enabled: false }], ['z gazem', G], ['z gazem (stara fizyka)', G, OLD_GAS, OLD_REZ],
        ['bez gazu (cząstki)', { enabled: true, gas: false }], ['z gazem (2)', G], ['z gazem (stara fizyka 2)', G, OLD_GAS, OLD_REZ], ['bez wybuchów (2)', { enabled: false }]];
    for (const [label, tune, gaz, rez] of LIST) {
      const r = await run(label, tune, gaz, rez);
      report.koszt.push(r);
      console.log('koszt', JSON.stringify(r));
    }
    await ev('(() => { const X = window.__explosions; Object.assign(X.tune, { enabled: true, gas: true, gridLight: true, obstacles: true, hullObstacles: true }); Object.assign(X.grid.tune, window.__kosztBaza.gaz); Object.assign(X.director.tune, window.__kosztBaza.rez); return true; })()');
  }

  if (args.marsz) {
    // F13 (etap D): KOSZT MARSZU objętości przy dużym wybuchu na ekranie. Pustka, zoomy z --marszZoom (domyślnie 0,4 i 0,8),
    // wybuch capital (size 282 — śmierć okrętu; R ≈ 450 j.: 180 / 360 px promienia). Dwie miary:
    //   (1) zatrzymana klatka (zegar gry stoi, klatki lecą) w 0,4 / 0,9 / 1,6 s: mediana Core3D.gpuFrameMs z bryłami gazu i bez
    //       (drawGas — sam marsz; symulacja stoi), ze światłami siatki w marszu i bez (gridLight), naprzemiennie ABBA;
    //   (2) czas rzeczywisty: seria 4 wybuchów w ~5 s wokół środka kadru (1–3 domeny), klatki i GPU — bryły gazu ↔ bez,
    //       naprzemiennie ABBA (ten sam przebieg — maszyna współdzielona).
    // --marszWarianty 'nazwa@look.k=v,…|…' — dodatkowe warianty obrazu (np. krok marszu) w obu miarach.
    const zooms = String(args.marszZoom || '0.4,0.8').split(',').map(Number);
    const VAR = args.marszWarianty ? String(args.marszWarianty).split('|').map((w) => {
      const [name, body = ''] = w.split('@');
      return { name, set: body.split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; }) };
    }) : [];
    report.marsz = [];
    const g = await ev('(() => { const S = window.StoryGame, d = S.site.dock, l = d.layout; const p = d.toGame(-6000, l.bounds.z1 + 4000); return { x: p.x, y: p.y }; })()');
    // A/B klucza (true / false) albo wariantu look (set / przywrócenie) na zatrzymanej klatce — mediany GPU.
    const frozenAB = (key, set, rounds = 2, ms = 1200) => ev(`(async () => {
      const X = window.__explosions, h = window.__harness, C = window.Core3D, L = X.volume.look, SET = ${JSON.stringify(set || null)};
      const prev = SET ? SET.map(([k]) => L[k.split('.')[1]]) : null;
      // marchBudget (F13): wł. — wartość gry, wył. — 0 (stały krok)
      const MB = X.tune.marchBudget || 40;
      const apply = (on) => { if (SET) SET.forEach(([k, v], i) => { L[k.split('.')[1]] = on ? v : prev[i]; });
        else if ('${key}' === 'marchBudget') X.tune.marchBudget = on ? MB : 0; else X.tune['${key}'] = on; };
      h.hold(false);
      const med = async () => { const r = []; const t0 = h.realNow();
        while (h.realNow() - t0 < ${ms}) { await new Promise((q) => setTimeout(q, 40)); const g = C.gpuFrameMs; if (g > 0) r.push(g); }
        r.sort((a, b) => a - b); return r.length ? r[r.length >> 1] : null; };
      const on = [], off = [];
      for (let i = 0; i < ${rounds}; i++) for (const st of (i % 2 ? [false, true] : [true, false])) {
        apply(st); await new Promise((q) => setTimeout(q, 450)); (st ? on : off).push(await med());
      }
      apply(SET ? false : true); h.hold(true);
      const m = (a) => { const v = a.filter((x) => x != null).sort((p, q) => p - q); return v.length ? +v[v.length >> 1].toFixed(3) : null; };
      return { klucz: '${key}', z: m(on), bez: m(off), roznica: m(on) != null && m(off) != null ? +(m(on) - m(off)).toFixed(3) : null, domeny: X.grid.stats.active };
    })()`, 120000);
    // F17: SKOK KLATKI PRZY ALOKACJI atlasów (świeża strona: atlasy 1 × 1 × 1) — czas rzeczywisty, wybuch mały (coarse),
    // średni (podstawowy), duży (fine) po kolei co 1,2 s przy zoomie 0,4; najdłuższa klatka 0,25 s po wybuchu ↔ mediana.
    await camAt(g.x, g.y, 0.4);
    report.alokacja = await ev(`(async () => {
      const X = window.__explosions, h = window.__harness, C = window.Core3D, G = X.grid;
      const c = window.camera; c.x = c.targetX = ${g.x}; c.y = c.targetY = ${g.y}; c.zoom = c.targetZoom = c.zoomBase = 0.4;
      h.hold(false); h.clock.mode = 'real';
      await new Promise((r) => setTimeout(r, 1000));
      const out = [];
      const alloc0 = G.grids.map((q) => q.allocated);
      for (const [name, size, dx] of [['coarse', 60, -3000], ['podstawowy', 100, 0], ['fine', 300, 3000]]) {
        const dts = []; let last = performance.now();
        for (let i = 0; i < 30; i++) { await new Promise((r) => requestAnimationFrame(r)); const n = performance.now(); dts.push(n - last); last = n; }
        const before = G.grids.map((q) => q.allocated);
        window.makeReactorBlow({ x: ${g.x} + dx, y: ${g.y}, size });
        const post = [];
        const t0 = performance.now();
        while (performance.now() - t0 < 250) { await new Promise((r) => requestAnimationFrame(r)); const n = performance.now(); post.push(n - last); last = n; }
        dts.sort((a, b) => a - b);
        out.push({ wybuch: name, alokacja: G.grids.map((q, i) => !before[i] && q.allocated ? (q === X.fine ? 'fine' : q === X.coarse ? 'coarse' : 'podstawowy') : null).filter(Boolean),
          medianaPrzed: +dts[dts.length >> 1].toFixed(2), maxPo: +Math.max(...post).toFixed(2), klatkiPo: post.map((v) => +v.toFixed(1)).slice(0, 6) });
        await new Promise((r) => setTimeout(r, 1200));
      }
      h.clock.t = h.realNow(); h.clock.mode = 'frozen'; h.hold(true);
      return { przedAlokacja: alloc0, wybuchy: out, pamMB: +(G.memoryBytes / 1e6).toFixed(1) };
    })()`, 120000);
    console.log('alokacja', JSON.stringify(report.alokacja));
    for (const zoom of zooms) {
      await ev(`(() => { window.__explosions.clear(); return true; })()`);
      await camAt(g.x, g.y, zoom);
      await ev('window.__harness.step(3)');
      await ev(`(() => { window.triggerReactorBlow3D(${g.x}, ${g.y}, 282); return true; })()`);
      const rows = [];
      let tNow = 0;
      for (const at of [0.4, 0.9, 1.6]) {
        const st = await shot(`marsz-z${String(zoom).replace('.', '_')}-${String(at).replace('.', '_')}`, Math.round((at - tNow) * 60));
        tNow = at;
        const row = { t: at, domeny: st?.domeny, marsz: await frozenAB('drawGas'), budzet: await frozenAB('marchBudget'), swiatla: await frozenAB('gridLight'),
          krok: await ev('+(window.__explosions.stats.marchStep || 1).toFixed(2)') };
        for (const w of VAR) row[`w_${w.name}`] = await frozenAB(w.name, w.set);
        rows.push(row);
        console.log('marsz', zoom, at, JSON.stringify(row));
      }
      // czas rzeczywisty
      const run = (label, tune, set) => ev(`(async () => {
        const X = window.__explosions, C = window.Core3D, L = X.volume.look, SET = ${JSON.stringify(set || null)};
        Object.assign(X.tune, ${JSON.stringify(tune)}); X.clear();
        const prev = SET ? SET.map(([k]) => L[k.split('.')[1]]) : null;
        if (SET) SET.forEach(([k, v]) => { L[k.split('.')[1]] = v; });
        const h = window.__harness; h.hold(false); h.clock.mode = 'real';
        await new Promise((r) => setTimeout(r, 800));
        const R = 451, pts = [[0, 0], [0.8 * R, 0.3 * R], [-0.5 * R, -0.7 * R], [0.2 * R, 0.9 * R]];
        const t0 = performance.now();
        let i = 0, last = t0, worst = 0, n = 0, maxDom = 0;
        const dts = [], gpu = [];
        while (performance.now() - t0 < 5200) {
          const el = performance.now() - t0;
          while (i < pts.length && el > 150 + i * 1200) { const p = pts[i++]; window.makeReactorBlow({ x: ${g.x} + p[0], y: ${g.y} + p[1], size: 282 }); }
          await new Promise((r) => requestAnimationFrame(r));
          const now = performance.now();
          const dt = now - last; last = now; n++; dts.push(dt); worst = Math.max(worst, dt);
          if (C.gpuFrameMs > 0) gpu.push(C.gpuFrameMs);
          maxDom = Math.max(maxDom, X.grid.stats.active + (X.fine ? X.fine.stats.active : 0));
        }
        h.clock.t = h.realNow(); h.clock.mode = 'frozen'; h.hold(true);
        if (SET) SET.forEach(([k], j) => { L[k.split('.')[1]] = prev[j]; });
        Object.assign(X.tune, { drawGas: true, marchBudget: ${MB} });
        dts.sort((a, b) => a - b); gpu.sort((a, b) => a - b);
        const q = (a, p) => a.length ? +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(3) : null;
        const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
        const ga = gpu.length ? gpu.reduce((a, b) => a + b, 0) / gpu.length : null;
        return { label: '${label}', klatki: n, sredniaMs: +avg.toFixed(2), p95: q(dts, 0.95), najgorszaMs: +worst.toFixed(1),
          gpuSr: ga != null ? +ga.toFixed(3) : null, gpuP50: q(gpu, 0.5), gpuP95: q(gpu, 0.95), gpuMax: q(gpu, 1), maxDomen: maxDom };
      })()`, 120000);
      // F13: budżet marszu wł. (gra) / wył. (stały krok) i bez brył — naprzemiennie
      const MB = await ev('window.__explosions.tune.marchBudget');
      const GAS = { drawGas: true, marchBudget: MB }, NOG = { drawGas: false, marchBudget: MB }, NOB = { drawGas: true, marchBudget: 0 };
      const LIST = [['bryły', GAS], ['bez brył', NOG], ['bryły bez budżetu', NOB], ['bryły bez budżetu (2)', NOB], ['bez brył (2)', NOG], ['bryły (2)', GAS]];
      for (const w of VAR) LIST.push([`bryły ${w.name}`, GAS, w.set], [`bryły (2)`, GAS], [`bryły ${w.name} (2)`, GAS, w.set]);
      const rt = [];
      for (const [label, tune, set] of LIST) { const r = await run(label, tune, set); rt.push(r); console.log('marsz rt', zoom, JSON.stringify(r)); }
      report.marsz.push({ zoom, rows, czasRzeczywisty: rt });
    }
  }
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  console.error(err);
  report.logi = logs.all().slice(-60);
} finally {
  report.bledy = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools|powerPreference|Unable to decode audio|AudioSys/.test(l)).slice(0, 60);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.slice(0, 20).join('\n'));
  // Kolizje uuid węzłów TSL (pułapka 38 — ma być 0; skrypt nie robi reseed).
  try { report.tslUuid = await ev('(() => { const u = window.Core3D?.tslUuid; return u ? { kolizje: u.kolizje } : null; })()'); console.log('tslUuid', JSON.stringify(report.tslUuid)); } catch { /* strona padła */ }
  writeJson(join(out, 'raport.json'), report);
  console.log('wyniki', out);
  await chrome.close();
  await server.close();
  process.exit(0);
}
