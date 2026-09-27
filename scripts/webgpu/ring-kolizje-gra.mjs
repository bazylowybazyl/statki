// Kolizje ringu w PRAWDZIWEJ grze (port WebGPU, zadanie 06): kolider płyty (HaloRingCollider)
// dostaje teren z mapy CPU dopiero po `ring.ready` — nigdy pustej mapy (wysokość 0). Gra w czasie
// rzeczywistym (bez zegara harnessu), tryb single, statek przy porcie ringu (?haloTest=<ring>&haloAt=port).
// Sprawdza: kiedy kolider dostał teren względem mapsReady, wysokości na obwodzie podłogi (z = 0,
// poza tranzytami) ≠ 0 i równe ring.terrainHeightAt, punkt w połowie najwyższego zbocza jest w płycie
// tylko z terenem (pointInSlab), a kopia statku gracza postawiona w nim zostaje wypchnięta (constrainShip).
//
//   node scripts/webgpu/ring-kolizje-gra.mjs [--ring earth|mars|jupiter] [--port 5340] [--out plik.json]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, evaluate, waitFor, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5340);
const key = args.ring || 'earth';

const { server, base } = await startVite(port);
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
let result = null;
try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&haloTest=${key}&haloAt=port` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady && window.ship)', 240000, 300)) throw new Error('gra nie wstała');
  // Sonda w stronie (od menu): kiedy ring powstał, kiedy kolider dostał teren, kiedy mapsReady.
  await ev(`(() => {
    const P = window.__ringProbe = { created: null, terrain: null, mapsReady: null, terrainWithoutRing: false };
    const t0 = performance.now();
    const tick = () => {
      const e = window.__haloRings?.entries?.find((x) => x.key === '${key}');
      const now = +(performance.now() - t0).toFixed(1);
      if (e?.ring && P.created === null) P.created = now;
      if (e?.ring?.mapsReady && P.mapsReady === null) P.mapsReady = now;
      if (e?.collider?.terrainHeightAt && P.terrain === null) {
        P.terrain = now;
        if (!e.ring?.isReady) P.terrainWithoutRing = true;
      }
      if (P.terrain === null || P.mapsReady === null) setTimeout(tick, 5);
    };
    tick();
    return true;
  })()`);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, 'window.__ringProbe.terrain !== null && window.__ringProbe.mapsReady !== null', 300000, 300)) {
    throw new Error(`ring ${key}: kolider bez terenu albo brak mapsReady (${await ev('JSON.stringify(window.__ringProbe)')})`);
  }
  await sleep(500);
  result = await ev(`(() => {
    const e = window.__haloRings.entries.find((x) => x.key === '${key}');
    const col = e.collider, ring = e.ring, place = col.place, fm = col.floorMid;
    const toGame = (lx, ly) => ({ x: place.x + lx * place.cos - ly * place.sin, y: place.y - (lx * place.sin + ly * place.cos) });
    const N = 7200;
    let n = 0, nonZero = 0, abovePad = 0, max = -Infinity, min = Infinity, sum = 0, diff = 0, top = 0;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      const lx = Math.cos(th) * fm, ly = Math.sin(th) * fm;
      if (col._inTransit(lx, ly)) continue;
      const h = Number(col.terrainHeightAt(lx, ly)) || 0;
      n++;
      if (h !== 0) nonZero++;
      if (h > 7) abovePad++;
      sum += h;
      if (h > max) { max = h; top = th; }
      if (h < min) min = h;
      diff = Math.max(diff, Math.abs(h - (Number(ring.terrainHeightAt(lx, ly, 0)) || 0)));
    }
    // w połowie najwyższego zbocza: w płycie tylko dzięki terenowi (płyty portu = 7 j.)
    const r = fm + Math.max(20, max * 0.5);
    const g = toGame(Math.cos(top) * r, Math.sin(top) * r);
    const inSlab = col.pointInSlab(g.x, g.y);
    const keep = col.terrainHeightAt;
    col.terrainHeightAt = null;
    const inSlabFlat = col.pointInSlab(g.x, g.y);
    col.terrainHeightAt = keep;
    const fake = { ...window.ship, pos: { x: g.x, y: g.y }, vel: { x: 0, y: 0 } };
    const c = col.constrainShip(fake, false);
    return {
      ring: '${key}', probeMs: window.__ringProbe,
      samples: n, nonZero, abovePad, min: +min.toFixed(3), max: +max.toFixed(3), mean: +(sum / n).toFixed(3),
      colliderVsRing: diff,
      slab: { r: +r.toFixed(1), inSlab, inSlabFlat },
      constrain: { hit: c.hit, floorPush: +c.floor.toFixed(2) }
    };
  })()`);
  result.errors = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference/.test(l)).slice(0, 10);
  console.log(JSON.stringify(result, null, 2));
  if (args.out) writeFileSync(resolve(repo, args.out), JSON.stringify(result, null, 2));
} catch (err) {
  console.log('BŁĄD', err.message);
  console.log(logs.errors().slice(0, 10).join('\n'));
  process.exitCode = 1;
} finally {
  await chrome.close();
  await server.close();
}
