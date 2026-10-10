// PRZESZKODY GAZU WYBUCHÓW (etap C — F2 docs/AUDYT-wybuchy-gaz-2026-10-08.md) w PRAWDZIWEJ grze: Vite + headless Chrome
// z WebGPU (CDP), czas wirtualny harnessu (klatka = 1/60 s), zrzuty na zatrzymanej klatce. Każda scena dwa razy z tym
// samym ziarnem efektów i zegarem gazu: z przeszkodami i bez (EXPLOSION_TUNE.obstacles / hullObstacles) — A/B obrazu.
//
//   node scripts/webgpu/przeszkody-gra.mjs [--sceny brama,wyrwa,przelot,hala] [--out .tmp/przeszkody-gra] [--rozmiar 1600x900]
//        [--port 5381]
//
// Sceny (misja 1, skok dev ?story=ram — suchy dok postawiony; gracz z dala od doku — kawałki to statyka):
//   brama   — wybuch na parkingu 350 j. od bramy taranowej G-W: brama, rama i ogrodzenie trzymają gaz,
//   wyrwa   — to samo z wyrwaną bramą (kawałek odpadł): gaz wylewa się otworem,
//   przelot — Atlas leci 500 j/s obok wybuchu (kadłub rozcina dym); maska kadłuba z GPU (przekrój velA.w) porównana
//             z obrysem encji liczonym na CPU z pozy (hullFootprint) — „rozjazd maski z kadłubem”,
//   ruszony — gracz w bańce (kawałki doku to ciała), brama G-W z wyrwą 260 j. (HullBodies.impact): gaz widzi obrys
//             ciała, nie bryłę trafień — wylewa się wyrwą,
//   gospodarz — pancernik w ruchu ginie, wybuch ze zbiornika WEWNĄTRZ kadłuba: wrak-gospodarz wyłączony z maski (gra) ↔
//             wrak jako przeszkoda (hostExclude false) ↔ bez przeszkód,
//   hala    — hala K-7 Ziemi: wybuch przy ścianie bocznej wewnątrz hali (ściana i przypory trzymają gaz).
// Raport: <out>/raport.json — liczniki (kadłuby i domeny z bryłami), zgodność maski, pipeline'y SYNCHRONICZNE (ma być 0).
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const sceny = String(args.sceny || 'brama,wyrwa,przelot,gospodarz,hala').split(',');
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/przeszkody-gra');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5381));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const report = { sceny: {}, bledy: [] };

const stats = () => ev(`(() => {
  const x = window.__explosions; if (!x) return null;
  const s = x.stats, g = x.grid.stats;
  return { spawned: s.spawned, gas: s.gas, domeny: g.active, kadluby: g.hulls, zBrylami: g.masked, przesuniete: s.moved,
    odlamkiWScianie: x.director.stats.blocked, pudla: x.grid._boxN, obrysy: x.grid._footN, gra: window.__gasObstStats };
})()`);
const pipesSince = (k0) => ev(`(() => {
  const p = window.__harness.pipes.list.filter((e) => e.k >= ${k0} && !e.budowa);
  const sync = p.filter((e) => e.sync && !e.compute);
  const nb = window.__harness.pipes.list.filter((e) => e.k >= ${k0} && e.budowa && !e.poza);
  return { sync: sync.length, budowyWKlatce: nb.length, lista: [...new Set(sync.map((e) => e.nazwa))].slice(0, 12), nbLista: [...new Set(nb.map((e) => e.nazwa))].slice(0, 12) };
})()`);
const frameK = () => ev('window.__harness.frameLog.n');
const camAt = (x, y, zoom) => ev(`(() => {
  const c = window.camera;
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = ${x}; c.y = c.targetY = ${y}; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  c.transition = null;
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  for (const el of document.querySelectorAll('.st-hint, .st-objective, .st-comm, .st-banner')) el.style.display = 'none';
  return true;
})()`);
async function shot(name) {
  await ev('window.__harness.frames(2)');
  await sleep(80);
  await screenshotPng(cdp, join(out, `${name}.png`));
}

// Wybuch z resetem stanu efektów (to samo ziarno, zegar gazu od zera) i przełącznikami przeszkód; `pre` — kod przed
// wybuchem (np. poza Atlasa), `boom` — kod wybuchu. Zrzuty w chwilach `times` [s]; `check` — kod po każdym zrzucie.
async function abScene(name, { pre = '', boom, times, check = null, settle = 2, variants = [['z', true], ['bez', false]] }) {
  const rows = [];
  for (const [tag, on] of variants) {
    const T = typeof on === 'object' ? on : { obstacles: on, hullObstacles: on };
    await ev(`(() => { const X = window.__explosions; X.clear(); Object.assign(X.tune, ${JSON.stringify(T)});
      X.director.stats.moved = 0; X.director.stats.blocked = 0; ${pre}; return true; })()`);
    // kadłuby budują się przy pierwszych rysunkach (settle klatek), potem to samo ziarno efektów i zegar gazu od zera
    await ev(`window.__harness.step(${settle})`);
    await ev('(() => { const X = window.__explosions; window.fxRandom.seed(0x0c0ffee5); X.grid.time = 0; X.director.time = 0; return true; })()');
    await ev(`(() => { ${boom}; return true; })()`);
    let tNow = 0;
    for (const at of times) {
      await ev(`window.__harness.step(${Math.max(1, Math.round((at - tNow) * 60))})`);
      tNow = at;
      await shot(`${name}-${tag}-${String(at).replace('.', '_')}`);
      const st = await stats();
      const extra = check ? await ev(check) : null;
      rows.push({ wariant: tag, t: at, ...st, ...(extra ? { maska: extra } : {}) });
      console.log(`${name}-${tag}-${at}`.padEnd(22), JSON.stringify(rows.at(-1)));
    }
  }
  await ev('(() => { const X = window.__explosions; Object.assign(X.tune, { obstacles: true, hullObstacles: true, hostExclude: true }); return true; })()');
  return rows;
}

// Maska kadłuba Atlasa na GPU (przekrój velA.w w połowie wysokości domeny) ↔ obrys encji z pozy na CPU (hullFootprint,
// próbka liniowa jak w kernelu): komórki, w których CPU jest pewny (|v − 0,5| > 0,1), a GPU się nie zgadza.
const MASK_CHECK = `(async () => {
  const X = window.__explosions, g = X.grid, r = window.Core3D.renderer, s = window.ship;
  const { hullFootprint, hullFootprintBit } = await import('/src/game/hullFootprint.js');
  const fp = hullFootprint(s, 64, 32);
  const th = -(s.angle + fp.rot), c = Math.cos(th), sn = Math.sin(th);
  const ax = s.pos.x, ay = s.pos.y;
  const bil = (qx, qy) => {
    const u = Math.min(63.5, Math.max(0.5, qx)) - 0.5, v = Math.min(31.5, Math.max(0.5, qy)) - 0.5;
    const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
    const b = (i, j) => hullFootprintBit(fp, Math.min(63, i), Math.min(31, j));
    return (b(i0, j0) * (1 - fu) + b(i0 + 1, j0) * fu) * (1 - fv) + (b(i0, j0 + 1) * (1 - fu) + b(i0 + 1, j0 + 1) * fu) * fv;
  };
  const res = { domeny: 0, komorkiKadluba: 0, pewne: 0, niezgodne: 0, niezgodneBrzeg: 0 };
  for (const sl of g.slots) {
    if (!sl.active) continue;
    res.domeny++;
    const slice = await g.probeSlice(r, sl.index);
    const N = g.N, h = sl.h;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const gx = sl.cx + (i + 0.5 - N / 2) * h, gy = -(sl.cy + (j + 0.5 - N / 2) * h);   // scena → gra
      const dx = gx - ax, dy = gy - ay;
      const X1 = c * dx - sn * dy, Y1 = -(sn * dx + c * dy);   // układ kadłuba: oś X (c, −s), oś Y (−s, −c)
      const qx = (X1 - fp.x0) / fp.tx, qy = (Y1 - fp.y0) / fp.ty;
      const inQ = qx > 0 && qx < 64 && qy > 0 && qy < 32;
      const v = inQ ? bil(qx, qy) : 0;
      const gpu = slice[(j * N + i) * 4] > 0.5 ? 1 : 0;
      if (v > 0.5) res.komorkiKadluba++;
      if (Math.abs(v - 0.5) > 0.1) { res.pewne++; if (gpu !== (v > 0.5 ? 1 : 0)) res.niezgodne++; }
      else if (gpu !== (v > 0.5 ? 1 : 0)) res.niezgodneBrzeg++;
    }
  }
  return res;
})()`;

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=ram` });
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
  await ev(`(() => {
    window.setFogOfWar?.(false);
    const S = window.StoryGame, d = S.site.dock, l = d.layout;
    const p = d.toGame(0, l.bounds.z1 + 9000); S.deps.placePlayer(p.x, p.y, d.axis); window.ship.vel.x = 0; window.ship.vel.y = 0;
    return true;
  })()`);
  await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
  await ev('window.__harness.step(30)');

  // Brama taranowa G-W (koniec parkingu, światło 880 j.): wybuch w parkingu 350 j. od bramy (kula R 480 sięga bramy).
  const gate = await ev(`(() => { const d = window.StoryGame.site.dock, l = d.layout, P = l.parking;
    const g = P.gates.find((q) => q.id === 'G-W');
    const p = d.toGame(g.x + 350, g.z), c = d.toGame(g.x + 60, g.z);
    return { id: g.id, x: p.x, y: p.y, cx: c.x, cy: c.y }; })()`);
  if (sceny.includes('brama') || sceny.includes('wyrwa')) {
    for (const nm of ['brama', 'wyrwa'].filter((q) => sceny.includes(q))) {
      const k0 = await frameK();
      await camAt(gate.cx, gate.cy, 0.22);
      if (nm === 'wyrwa') await ev(`(() => { window.StoryGame.site.station._dock3d.hideChunk('${gate.id}'); return true; })()`);
      await ev('window.__harness.step(3)');
      const rows = await abScene(nm, {
        boom: `window.makeReactorBlow({ x: ${gate.x}, y: ${gate.y}, size: 300, profile: 'capital' })`,
        times: [0.4, 1.0, 2.0, 3.2]
      });
      report.sceny[nm] = { gate, rows, pipeline: await pipesSince(k0) };
      console.log(nm, 'pipeline', JSON.stringify(report.sceny[nm].pipeline));
    }
  }

  if (sceny.includes('ruszony')) {
    // Kawałek RUSZONY (ciało silnika belek z wyrwą): gracz w bańce (kawałki doku to ciała), brama G-W z dziurą 260 j.
    // na środku — gaz widzi obrys ciała (maska z żywych węzłów), nie bryłę trafień: wylewa się wyrwą.
    const k0 = await frameK();
    const info = await ev(`(async () => {
      const S = window.StoryGame, d = S.site.dock, st = S.site.station, l = d.layout, g = l.parking.gates.find((q) => q.id === 'G-W');
      const pl = d.toGame(g.x - 3200, g.z); S.deps.placePlayer(pl.x, pl.y, d.axis); window.ship.vel.x = 0; window.ship.vel.y = 0;
      const h = window.__harness;
      let p = null;
      for (let i = 0; i < 400; i++) { await h.step(1); p = window.WorldBodies.piece(st._worldSite, 'G-W'); if (p && p.state === 'live' && p.entity) break; }
      if (!p?.entity) return { ok: false, state: p?.state };
      const c = d.toGame(g.x, g.z);
      const hit = window.HullBodies.impact(p.entity, c.x, c.y, 5000, null, { craterRadius: 130 });
      await h.step(30);
      // ruszony = rana / przesunięcie węzła (worldBodies._checkPiece); gdy krater nie zabił węzłów — wymuszone (ścieżka obrysu)
      const forced = !p.touched;
      if (forced) p.touched = true;
      await h.step(20);
      const b = d.toGame(g.x + 350, g.z), cam = d.toGame(g.x + 60, g.z);
      return { ok: true, hit: !!hit, forced, nodes: p.entity?.beamHull?.body?.activeNodes ?? null, base: p.baseNodes, touched: !!p.touched, state: p.state, islands: p.islands.length, x: b.x, y: b.y, cx: cam.x, cy: cam.y };
    })()`);
    console.log('ruszony', JSON.stringify(info));
    if (info.ok) {
      await camAt(info.cx, info.cy, 0.22);
      await ev('window.__harness.step(20)');
      const rows = await abScene('ruszony', {
        boom: `window.makeReactorBlow({ x: ${info.x}, y: ${info.y}, size: 300, profile: 'capital' })`,
        times: [0.4, 1.0, 2.0, 3.2]
      });
      report.sceny.ruszony = { info, rows, pipeline: await pipesSince(k0) };
      console.log('ruszony pipeline', JSON.stringify(report.sceny.ruszony.pipeline));
    } else report.sceny.ruszony = { info };
  }

  if (sceny.includes('przelot')) {
    // Atlas 500 j/s na kursie x przez środek wybuchu (capital 260 — R 416): dziób w środku kuli po ~1,6 s, rufa wychodzi
    // po ~3,6 s — kadłub rozcina obłok.
    const k0 = await frameK();
    const P = await ev('(() => { const d = window.StoryGame.site.dock, l = d.layout; const p = d.toGame(4000, l.bounds.z1 + 6000); return { x: p.x, y: p.y }; })()');
    const pre = `const S = window.StoryGame; S.deps.placePlayer(${P.x} - 1700, ${P.y}, 0); const s = window.ship; s.angle = 0; s.vel.x = 500; s.vel.y = 0; s.angVel = 0;
      window.__fly = window.__fly || { on: false }; window.__fly.on = true;
      if (!window.__flyTick) { window.__flyTick = true; const tick = () => { if (window.__fly.on) { const q = window.ship; q.vel.x = 500; q.vel.y = 0; q.angle = 0; q.angVel = 0; } requestAnimationFrame(tick); }; requestAnimationFrame(tick); }`;
    await camAt(P.x + 300, P.y, 0.24);
    const rows = await abScene('przelot', {
      pre,
      boom: `window.makeReactorBlow({ x: ${P.x}, y: ${P.y} + 120, size: 260, profile: 'capital' })`,
      times: [0.6, 1.4, 2.2, 3.0, 3.8],
      check: MASK_CHECK
    });
    await ev('(() => { window.__fly.on = false; window.ship.vel.x = 0; return true; })()');
    report.sceny.przelot = { rows, pipeline: await pipesSince(k0) };
    console.log('przelot pipeline', JSON.stringify(report.sceny.przelot.pipeline));
  }

  if (sceny.includes('gospodarz')) {
    // Piracki pancernik w ruchu (160 j/s) ginie — wybuch ze zbiornika paliwa WEWNĄTRZ kadłuba (A2): wrak-gospodarz
    // wyłączony z maski (gra) ↔ wrak jako przeszkoda (hostExclude false) ↔ bez przeszkód.
    const k0 = await frameK();
    const P = await ev('(() => { const d = window.StoryGame.site.dock, l = d.layout; const p = d.toGame(-6000, l.bounds.z1 + 7000); return { x: p.x, y: p.y }; })()');
    await camAt(P.x, P.y, 0.22);
    const rows = await abScene('gospodarz', {
      pre: `const r = window.spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: { x: ${P.x} - 80, y: ${P.y} + 30 }, pos: { x: ${P.x} - 80, y: ${P.y} + 30 }, spawnAngle: -0.35 });
        const n = Array.isArray(r) ? r[0] : r; n.combatDisabled = true; n.ai = null; n.__fogVisible = true; window.__hostNpc = n;`,
      boom: `const n = window.__hostNpc; n.angle = -0.35; n.vx = Math.cos(-0.35) * 160; n.vy = Math.sin(-0.35) * 160;
        window.applyDamageToNPC(n, (n.hp || 1) + (n.shield?.val || 0) + 1e6, 'default', { bypassShield: true })`,
      times: [0.3, 0.8, 1.5, 2.5],
      settle: 40,
      variants: [['z', { obstacles: true, hullObstacles: true, hostExclude: true }], ['gospodarz', { obstacles: true, hullObstacles: true, hostExclude: false }],
        ['bez', { obstacles: false, hullObstacles: false, hostExclude: true }]]
    });
    report.sceny.gospodarz = { rows, pipeline: await pipesSince(k0) };
    console.log('gospodarz pipeline', JSON.stringify(report.sceny.gospodarz.pipeline));
  }

  if (sceny.includes('hala')) {
    // Hala 0 K-7 Ziemi: wybuch przy ścianie bocznej (x = połowa szerokości − 650 w układzie hali, środek głębokości).
    const k0 = await frameK();
    const place = await ev(`(async () => {
      const m = await import('/src/game/hallDustInput.js');
      const L = (await import('/src/3d/haloRing/haloPortK7Layout.js')).createK7Layout();
      const e = window.__haloRings.entries.find((q) => q.key === 'earth');
      const owner = e.collider.registry.halls[0];
      const a = m.hallToGameAffine(e.collider.place, owner.frame, {});
      const at = (x, z) => ({ x: a.p0x + x * a.ax + z * a.bx, y: a.p0y + x * a.ay + z * a.by });
      const zMid = (L.backZ + L.frontZ) * 0.5;
      const boom = at(L.halfWidth - 380, zMid), cam = at(L.halfWidth - 600, zMid), ship = at(-810, 1900);
      window.DevScene.teleport(ship.x, ship.y, Math.atan2(a.by, a.bx));
      return { boom, cam };
    })()`);
    await camAt(place.cam.x, place.cam.y, 0.2);
    // ring i hala budują się przy kamerze (czas rzeczywisty)
    await ev('(() => { const h = window.__harness; h.clock.mode = "real"; h.hold(false); return true; })()');
    await sleep(9000);
    await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
    await camAt(place.cam.x, place.cam.y, 0.24);
    await ev('window.__harness.step(4)');
    const rows = await abScene('hala', {
      boom: `window.makeReactorBlow({ x: ${place.boom.x}, y: ${place.boom.y}, size: 300, profile: 'capital' })`,
      times: [0.4, 1.0, 2.0, 3.2]
    });
    report.sceny.hala = { place, rows, pipeline: await pipesSince(k0) };
    console.log('hala pipeline', JSON.stringify(report.sceny.hala.pipeline));
  }
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  console.error(err);
  report.logi = logs.all().slice(-60);
} finally {
  report.bledy = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools|powerPreference|Unable to decode audio|AudioSys/.test(l)).slice(0, 60);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.slice(0, 20).join('\n'));
  try { report.tslUuid = await ev('(() => { const u = window.Core3D?.tslUuid; return u ? { kolizje: u.kolizje } : null; })()'); console.log('tslUuid', JSON.stringify(report.tslUuid)); } catch { /* strona padła */ }
  writeJson(join(out, 'raport.json'), report);
  console.log('wyniki', out);
  await chrome.close();
  await server.close();
  process.exit(0);
}
