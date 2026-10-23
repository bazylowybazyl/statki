// Kolizje ringu w PRAWDZIWEJ grze, na ŚWIECIE GRY (RW-27, `window.__haloWorld.entries[].collider` —
// HaloRingCollider w src/game/haloRingWorld.js), więc działa w trybie `off` i w workerze renderu
// (`--query renderWorker=1`; obrazu ringu na stronie wtedy nie ma). Gra w czasie rzeczywistym (bez zegara
// harnessu), tryb single, statek przy porcie ringu (?haloTest=<ring>&haloAt=port).
// Teren kolidera: Mars (ECUMENE) i Jowisz (BUDOWA) od razu z planów CPU (przy powstaniu świata), Ziemia z mapy
// CPU ringu obrazu po jego zbudowaniu (`off`: funkcja ringu, worker: mapa przez postMessage) — sonda notuje,
// kiedy powstał świat i kiedy wpis dostał teren (`terrainReady`).
// Sprawdza (wynik `ok`, kod wyjścia 1 przy porażce):
//   • teren: wysokości na obwodzie podłogi (r = floorMid, z = 0, poza tranzytami) nie są same zera;
//     w `off` sonda czeka na mapy obrazu ringu (`mapsReady`) i teren kolidera = ring.terrainHeightAt (< 1e-3;
//     archetypy: plan CPU gry ↔ treść ringu obrazu); w workerze obrazu na stronie nie ma — bez porównania;
//   • płyta [kadłub, podłoga + teren] (layout.radii back / floorMid): środek płyty w płycie poza tranzytami,
//     pod kadłubem (back − 30) i nad terenem (floorMid + 1 500) wolno — pointInSlab;
//   • punkt w połowie najwyższego zbocza jest w płycie tylko z terenem (pointInSlab z terenem i bez), a kopia
//     statku gracza postawiona w nim zostaje wypchnięta (constrainShip) — gdy teren sięga wyżej niż 2 × płyty
//     portu (7 j.); pokład Jowisza (BUDOWA) jest płaski — teren to płyty doków i baraki w płaszczyźnie gry (zbocze = ściana baraku); bez nich (`slope.brak`, nie porażka);
//   • kopia statku w środku płyty zostaje wypchnięta.
//
//   node scripts/webgpu/ring-kolizje-gra.mjs [--ring earth|mars|jupiter] [--query renderWorker=1]
//        [--port 5340] [--out plik.json]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, evaluate, waitFor, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5340);
const key = args.ring || 'earth';
const query = args.query ? `&${args.query}` : '';

const { server, base } = await startVite(port);
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
let result = null;
try {
  // bez kampanii i samouczka: tryb single startuje od razu przy porcie ringu
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&haloTest=${key}&haloAt=port${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && (window.Core3D.gpuReady || window.RenderWorkerHost) && window.ship)', 240000, 300)) throw new Error('gra nie wstała');
  // Sonda w stronie (od menu): kiedy powstał świat ringu (kolider), kiedy wpis dostał teren.
  await ev(`(() => {
    const P = window.__ringProbe = { world: null, terrain: null, terrainAtWorld: false };
    const t0 = performance.now();
    const tick = () => {
      const e = window.__haloWorld?.entries?.find((x) => x.key === '${key}');
      const now = +(performance.now() - t0).toFixed(1);
      if (e?.collider && P.world === null) { P.world = now; P.terrainAtWorld = !!e.terrainReady; }
      if (e?.terrainReady && e.collider?.terrainHeightAt && P.terrain === null) P.terrain = now;
      if (P.terrain === null) setTimeout(tick, 5);
    };
    tick();
    return true;
  })()`);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, 'window.__ringProbe.world !== null', 300000, 300)) throw new Error(`świat ringu ${key} nie powstał`);
  if (!await waitFor(cdp, 'window.__ringProbe.terrain !== null', 300000, 300)) {
    throw new Error(`ring ${key}: kolider bez terenu (${await ev('JSON.stringify(window.__ringProbe)')})`);
  }
  // `off`: obraz ringu na stronie — czekamy na jego mapy, żeby porównać teren kolidera z obrazem
  const worker = await ev(`window.__renderModeBoot?.mode === 'worker'`);
  if (!worker && !await waitFor(cdp, `!!window.__haloRings?.entries?.find((x) => x.key === '${key}')?.ring?.mapsReady`, 300000, 400)) {
    throw new Error(`ring ${key}: obraz ringu bez mapsReady (tryb off)`);
  }
  await sleep(500);
  result = await ev(`(() => {
    const e = window.__haloWorld.entries.find((x) => x.key === '${key}');
    const col = e.collider, place = col.place, R = col.layout.radii, fm = R.floorMid;
    const PAD = 7;  // HALO_COLLISION.padHeight — płyty portu nad podłogą
    const toGame = (a, r) => { const lx = Math.cos(a) * r, ly = Math.sin(a) * r; return { x: place.x + lx * place.cos - ly * place.sin, y: place.y - (lx * place.sin + ly * place.cos) }; };
    const mode = window.__renderModeBoot?.mode || 'off';
    // obraz ringu na stronie (tylko off / inline; w workerze stan ringu jest poza stroną)
    const img = window.__haloRings?.entries?.find((x) => x.key === '${key}')?.ring;
    const imgMaps = !!(img && img.mapsReady && typeof img.terrainHeightAt === 'function');
    const N = 7200;
    let n = 0, nonZero = 0, abovePad = 0, max = -Infinity, min = Infinity, sum = 0, diff = imgMaps ? 0 : null, top = 0;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      const lx = Math.cos(th) * fm, ly = Math.sin(th) * fm;
      if (col._inTransit(lx, ly)) continue;
      const h = Number(col.terrainHeightAt(lx, ly)) || 0;
      n++;
      if (h !== 0) nonZero++;
      if (h > PAD) abovePad++;
      sum += h;
      if (h > max) { max = h; top = th; }
      if (h < min) min = h;
      if (imgMaps) diff = Math.max(diff, Math.abs(h - (Number(img.terrainHeightAt(lx, ly, 0)) || 0)));
    }
    // płyta na obwodzie: środek w płycie, pod kadłubem i wysoko nad terenem wolno
    const M = 3600;
    const plyta = { probki: 0, tranzyt: 0, wPlycie: 0, podKadlubem: 0, nadTerenem: 0 };
    for (let i = 0; i < M; i++) {
      const a = (i / M) * Math.PI * 2;
      const m = toGame(a, 0.5 * (R.back + fm));
      if (!col.pointInSlab(m.x, m.y)) { plyta.tranzyt++; continue; }
      plyta.probki++;
      const lo = toGame(a, R.back + 10), hi = toGame(a, fm - 10), under = toGame(a, R.back - 30), over = toGame(a, fm + 1500);
      if (col.pointInSlab(lo.x, lo.y) && col.pointInSlab(hi.x, hi.y)) plyta.wPlycie++;
      if (col.pointInSlab(under.x, under.y)) plyta.podKadlubem++;
      if (col.pointInSlab(over.x, over.y)) plyta.nadTerenem++;
    }
    const pushAt = (g) => {
      const fake = { ...window.ship, pos: { x: g.x, y: g.y }, vel: { x: 0, y: 0 } };
      const c = col.constrainShip(fake, false);
      return { hit: c.hit, push: +c.floor.toFixed(2) };
    };
    // w połowie najwyższego zbocza: w płycie tylko dzięki terenowi
    let slope = null;
    if (max > 2 * PAD) {
      const r = fm + max * 0.5;
      const g = toGame(top, r);
      const inSlab = col.pointInSlab(g.x, g.y);
      const keep = col.terrainHeightAt;
      col.terrainHeightAt = null;
      const inSlabFlat = col.pointInSlab(g.x, g.y);
      col.terrainHeightAt = keep;
      slope = { r: +r.toFixed(1), inSlab, inSlabFlat, ...pushAt(g) };
    }
    // statek w środku płyty (pierwszy kąt poza tranzytem)
    let mid = null;
    for (let i = 0; i < 64 && !mid; i++) {
      const g = toGame(0.6 + i * 0.05, 0.5 * (R.back + fm));
      if (col.pointInSlab(g.x, g.y)) mid = pushAt(g);
    }
    const fails = [];
    if (!(n > 0 && nonZero > 0)) fails.push('teren: same zera na obwodzie podłogi');
    if (!(plyta.probki > 0 && plyta.wPlycie === plyta.probki)) fails.push('płyta: brzegi płyty poza płytą');
    if (plyta.podKadlubem || plyta.nadTerenem) fails.push('płyta: kolizja pod kadłubem albo nad terenem');
    // płaski pokład bez baraków w płaszczyźnie gry: zbocza nie ma, płytę trzymają płyty portu
    if (!slope) slope = { brak: 'teren nie wyższy niż 2 × płyty portu (płaski pokład)' };
    else if (!slope.inSlab || slope.inSlabFlat || !slope.hit) fails.push('zbocze: punkt nie w płycie z terenem / w płycie bez terenu / brak wypchnięcia');
    if (!mid?.hit) fails.push('środek płyty: brak wypchnięcia');
    if (mode !== 'worker' && !(diff !== null && diff < 1e-3)) fails.push('teren kolidera ≠ teren obrazu ringu (off)');
    return {
      ring: '${key}', mode, ok: fails.length === 0, fails, probeMs: window.__ringProbe,
      plyta: { ...plyta, back: Math.round(R.back), floorMid: Math.round(fm) },
      teren: { samples: n, nonZero, abovePad, min: +min.toFixed(3), max: +max.toFixed(3), mean: +(sum / n).toFixed(3), colliderVsRing: diff },
      slope, mid,
      // czasy budowy map obrazu (silnik Halo, tylko off; archetypy nie pieką map)
      bake: img?.stats?.bake || null
    };
  })()`);
  result.errors = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference/.test(l)).slice(0, 10);
  console.log(JSON.stringify(result, null, 2));
  if (args.out) writeFileSync(resolve(repo, args.out), JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (err) {
  console.log('BŁĄD', err.message);
  console.log(logs.errors().slice(0, 10).join('\n'));
  process.exitCode = 1;
} finally {
  await chrome.close();
  await server.close();
}
