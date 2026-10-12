// Tunelowanie kadłubów (przelot bez styku) i głębokość pierwszego styku w PRAWDZIWEJ grze — 2026-10-11.
// Silnik belek (src/game/destructorBeams3D.js, collideBodies) szuka styków dyskretnie, w pozach z końca kroku,
// a krok fizyki gry jest od 2026-10-11 domyślnie 60 Hz (`?physHz=120` — A/B). Narzędzie ma dwa tryby:
//
//   node scripts/webgpu/tunelowanie-gra.mjs --tryb zrzut [--port 5297]
//     Rastry kadłubów z gry (obraz, z którego silnik buduje ciało, skala sprite'a, komórka w j. świata, masa, profil)
//     → .tmp/tunelowanie/kadluby.json — wejście symulacji w Node (`node scripts/tunelowanie-sym.mjs`).
//
//   node scripts/webgpu/tunelowanie-gra.mjs --tryb gra [--hz 60|120] [--port 5297]
//     Potwierdzenie w pętli gry (pusta przestrzeń między Wenus a Ziemią, gracz nieśmiertelny): Atlas
//     prowadzony stałą prędkością (jak rampa wyjścia z warpa: prędkość pisana co krok) przez kadłuby NPC
//     — czołowo i po brzegu, przy prędkościach gry (dopalacz 1500, PRZELOT 3000) i rampy wyjścia z warpa —
//     oraz skok warpem przez szereg okrętów. Liczy styki pary (HullBodies.hasContact, zdarzenia CollisionFX)
//     i zniszczone węzły.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startVite, navigateAndWait, evaluate, sleep, repo } from '../../dema/rdzen-cdp.js';
import { startChrome } from './wspolne.mjs';

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const TRYB = arg('tryb', 'zrzut');
const HZ = Number(arg('hz', 60));
const PORT = Number(arg('port', 5297));
const OUT = join(repo, '.tmp', 'tunelowanie');
mkdirSync(OUT, { recursive: true });

const { server, base } = await startVite(PORT);
const chrome = await startChrome({ width: 1280, height: 720 });
const { cdp, logs } = chrome;
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); localStorage.setItem('sc_fog_of_war', '0'); } catch {}
  let s = 7;
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
})();` });
const ev = (e) => evaluate(cdp, e);

// Pusta przestrzeń między Wenus a Ziemią, gracz nieśmiertelny, kamera daleko (render nie przeszkadza w pomiarze).
const START = `(() => {
  const pl = (window.planets || []).map((p) => ({ x: p.x ?? p.pos?.x, y: p.y ?? p.pos?.y, n: p.name || p.id })).filter((p) => Number.isFinite(p.x));
  const sun = window.SUN || { x: 0, y: 0 };
  const rOf = (re) => { const p = pl.find((q) => re.test(String(q.n))); return p ? Math.hypot(p.x - sun.x, p.y - sun.y) : NaN; };
  const R = (rOf(/venus|wenus/i) + rOf(/earth|ziemia/i)) / 2;
  let best = null;
  for (let k = 0; k < 96; k++) {
    const a = (k / 96) * Math.PI * 2, x = sun.x + Math.cos(a) * R, y = sun.y + Math.sin(a) * R;
    let dmin = Infinity; for (const p of pl) dmin = Math.min(dmin, Math.hypot(p.x - x, p.y - y));
    if (!best || dmin > best.dmin) best = { x, y, dmin };
  }
  window.DevScene.teleport(best.x, best.y, 0); window.DevScene.syncCamera();
  window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
    if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
  const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = 0.08;
  return { x: best.x, y: best.y };
})()`;

// Kadłuby: Atlas gracza + NPC z wezwań (obie strony). Obraz rastrowany na kanwie, jeśli nie jest już RGBA.
const KLUCZE = ['frigate_pd', 'destroyer', 'battleship', 'pirate_battleship', 'carrier', 'supercapital', 'pirate_supercapital'];
const ZRZUT = `(async () => {
  const s = window.ship;
  const out = [];
  const put = (key) => { try { return [].concat(window.spawnCallInShip(key, { mode: key.startsWith('pirate') ? 'pirate' : 'friendly',
    spawnPos: { x: s.pos.x + 40000 + out.length * 9000, y: s.pos.y + 30000 }, pos: { x: s.pos.x + 40000 + out.length * 9000, y: s.pos.y + 30000 } }) || []); } catch (e) { return []; } };
  const spawned = [];
  for (const k of ${JSON.stringify(KLUCZE)}) { const l = put(k); for (const e of l) { e.__tunKey = k; spawned.push(e); } out.push(k); }
  // Kadłuby powstają w budżecie klatki (hexInitBudgetAllows) — czekamy, aż wszystkie dostaną beamHull.
  for (let t = 0; t < 400 && spawned.some((e) => !e.beamHull && !e.dead); t++) await new Promise((r) => setTimeout(r, 50));
  const rgba = (img) => {
    if (img && img.data && img.width) return { w: img.width, h: img.height, data: img.data };
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return { w, h, data: g.getImageData(0, 0, w, h).data };
  };
  const b64 = (u8) => { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); };
  const rec = (e, key) => {
    const h = e.beamHull; if (!h) return { key, brak: true };
    const r = rgba(h.image);
    return { key, profil: h.body?.name || null, hullProfileId: e.shipFrame || e.activeHullId || e.model3DProfileId || e.type,
      typ: e.type, scale: h.scale, cellSize: h.cellSize, mass: e.mass, radius: e.radius, w: e.w, h: e.h,
      wezly: h.body.activeNodes, armor: h.body.collisionArmor, obraz: { w: r.w, h: r.h, rgba: b64(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength)) } };
  };
  const res = [rec(s, 'atlas')];
  for (const e of spawned) res.push(rec(e, e.__tunKey));
  return JSON.stringify(res);
})()`;

try {
  await navigateAndWait(cdp, `${base}/index.html?dev=1&physHz=${HZ}`, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 180000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  for (let t0 = Date.now(); Date.now() - t0 < 240000;) {
    await sleep(250);
    try { if (await ev('(window.__frameId || 0) > 30 && !!window.camera && !!window.ship?.beamHull')) break; } catch { /* ładuje się */ }
  }
  const start = await ev(START);
  console.log('start', JSON.stringify(start));
  if (TRYB === 'zrzut') {
    const json = await ev(ZRZUT);
    const lista = JSON.parse(json);
    writeFileSync(join(OUT, 'kadluby.json'), json);
    for (const k of lista) console.log(k.key, k.brak ? 'BRAK' : `${k.hullProfileId} obraz ${k.obraz.w}×${k.obraz.h} skala ${k.scale} komórka ${k.cellSize?.toFixed?.(2)} węzły ${k.wezly} masa ${Math.round(k.mass)} pancerz ${k.armor}`);
    console.log('zapis:', join(OUT, 'kadluby.json'));
  }
  if (TRYB === 'gra') {
    const wyniki = { hz: HZ };
    // Dziennik styków Atlasa: owinięty collideBodies silnika (wynik bez zmian). Zapis: prędkość statku, stan warpa.
    await ev(`(() => {
      const s = window.ship, D = window.HullBodies.engine;
      window.DevFlags.unlimitedWarp = true;
      s.angle = 0; s.vel.x = 0; s.vel.y = 0; s.angVel = 0;
      // Straty Atlasa: węzły kadłuba i punkty (kadłub + tarcza) — bez nieśmiertelności, uzupełniane między scenami.
      clearInterval(window.__godTimer);
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max;
      const T = window.__tun = { on: false, log: [], nodes0: s.beamHull?.body.activeNodes || 0,
        hp0: (s.hull?.val || 0) + (s.shield?.val || 0) };
      const orig = D.collideBodies;
      D.collideBodies = function (A, B, dt, doDamage) {
        const c = orig.call(this, A, B, dt, doDamage);
        if (c > 0 && T.on && (A.entity === s || B.entity === s)) {
          const o = A.entity === s ? B.entity : A.entity;
          T.log.push({ t: +window.HullBodies.simTime.toFixed(4), cel: o.__tunId ?? -1, v: Math.round(Math.hypot(s.vel.x, s.vel.y)),
            warp: window.warp.state, rampa: !!window.warp.exitRamp?.active, styki: c, iter: doDamage ? 0 : 1 });
        }
        return c;
      };
      return true;
    })()`);
    // Szereg okrętów na kursie Atlasa (w pauzie — kadłuby budują się w renderze); odległości wzdłuż kursu od statku,
    // boki — przesunięcia w poprzek kursu (na zmianę). Okręty uśpione, bez mózgu, nieruchome.
    const SPAWN = (odl, boki) => `(async () => {
      const s = window.ship;
      const ang = (window.warp.dir.x || window.warp.dir.y) ? Math.atan2(window.warp.dir.y, window.warp.dir.x) : s.angle;
      const d = { x: Math.cos(ang), y: Math.sin(ang) };
      const keys = ['pirate_battleship', 'destroyer', 'frigate_pd', 'pirate_supercapital', 'battleship'];
      const odl = ${JSON.stringify(odl)}, boki = ${JSON.stringify(boki)};
      const list = [];
      for (let i = 0; i < odl.length; i++) {
        const along = odl[i], side = boki[i % boki.length];
        const pos = { x: s.pos.x + d.x * along - d.y * side, y: s.pos.y + d.y * along + d.x * side };
        const key = keys[i % keys.length];
        for (const e of [].concat(window.spawnCallInShip(key, { mode: 'pirate', spawnPos: pos, pos, spawnAngle: ang + Math.PI / 2 }) || [])) {
          e.__tunId = list.length; e.__tunKey = key; e.combatDisabled = true; e.ai = null; list.push(e);
        }
      }
      for (let t = 0; t < 600 && list.some((e) => !e.beamHull && !e.dead); t++) await new Promise((r) => setTimeout(r, 50));
      for (const e of list) { e.x = e.pos?.x ?? e.x; e.vx = 0; e.vy = 0; if (e.vel) { e.vel.x = 0; e.vel.y = 0; } e.__tunNodes0 = e.beamHull?.body.activeNodes || 0; }
      window.__tunCele = list;
      return { n: list.length, kadluby: list.filter((e) => e.beamHull).length };
    })()`;
    const RAPORT = `(() => {
      const list = window.__tunCele || [];
      const per = list.map((e) => ({ id: e.__tunId, key: e.__tunKey, zginal: !!(e.dead || e.destroyed || !window.npcs.includes(e)),
        utrataWezlow: e.beamHull ? e.__tunNodes0 - e.beamHull.body.activeNodes : e.__tunNodes0 }));
      const log = window.__tun.log.splice(0);
      const s = window.ship, T = window.__tun, n = s.beamHull?.body.activeNodes || 0;
      const atlas = { utrataWezlow: T.nodes0 - n, utrataPunktow: Math.round(T.hp0 - (s.hull?.val || 0) - (s.shield?.val || 0)), zniszczony: !!(s.dead || s.destroyed) };
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max;
      T.nodes0 = n; T.hp0 = (s.hull?.val || 0) + (s.shield?.val || 0);
      const trafione = new Set(log.map((r) => r.cel));
      return { atlas, styki: log.length, okretyZeStykiem: trafione.size, okrety: list.length, zgineli: per.filter((p) => p.zginal).length,
        uszkodzone: per.filter((p) => p.utrataWezlow > 0).length, predkosciStykow: [...new Set(log.map((r) => r.v))].slice(0, 12),
        stany: [...new Set(log.map((r) => r.warp + (r.rampa ? '+rampa' : '')))], log: log.slice(0, 40), per };
    })()`;
    const czekaj = async (expr, ms = 60000) => { for (let t0 = Date.now(); Date.now() - t0 < ms;) { if (await ev(expr)) return true; await sleep(25); } return false; };
    const pauza = (on) => ev(`window.__setGamePaused(${on}); true`);

    // --- 1. SKOK: warp pełną prędkością przez szereg 40 okrętów (co 600 j., boki 0 / ±120 j.) ---
    await ev(`window.runGameAction('nav.warp'); true`);
    const aktywny = await czekaj(`window.warp.state === 'active'`, 60000);
    await sleep(1500);                                  // rozpęd skoku do prędkości przelotowej
    await pauza(true);
    wyniki.skokPredkosc = await ev(`Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y))`);
    console.log('skok aktywny', aktywny, 'prędkość', wyniki.skokPredkosc);
    const odlSkok = Array.from({ length: 40 }, (_, i) => 60000 + i * 600);
    console.log('cele skoku', JSON.stringify(await ev(SPAWN(odlSkok, [0, 120, -120]))));
    await ev(`window.__tun.on = true; true`);
    await pauza(false);
    await czekaj(`(() => { const s = window.ship, l = window.__tunCele, last = l[l.length - 1]; const ang = Math.atan2(window.warp.dir.y, window.warp.dir.x);
      return ((s.pos.x - last.x) * Math.cos(ang) + (s.pos.y - last.y) * Math.sin(ang)) > 20000; })()`, 30000);
    await pauza(true);
    wyniki.skok = await ev(RAPORT);
    console.log('SKOK', JSON.stringify({ ...wyniki.skok, log: undefined, per: undefined }));
    await ev(`for (const e of window.__tunCele) { e.dead = true; } window.__tun.on = false; true`);

    // --- 2. RAMPA WYJŚCIA: wyjście z warpa, okręty na drodze zwolnienia, wlotu i hamowania ---
    await pauza(false);
    await sleep(400);
    await pauza(true);
    await ev(`window.runGameAction('nav.warp'); true`);
    const rampa = await ev(`(async () => {
      const r = window.warp.exitRamp; if (!r) return null;
      const W = await import('/src/game/warpDrive.js');
      // Droga od początku rampy w chwilach t (całka prędkości, krok 1 ms).
      const out = {}, at = (t) => { let d = 0; for (let a = 0; a < t; a += 0.001) d += W.sampleWarpExitRamp(r, a + 0.0005, out).speed * 0.001; return d; };
      const pts = [];
      for (const t of [r.tSlowEnd * 0.6, r.tSlowEnd * 0.85, r.tSlowEnd + (r.tBrake - r.tSlowEnd) * 0.3, r.tSlowEnd + (r.tBrake - r.tSlowEnd) * 0.8, r.tBrake + r.brake * 0.3, r.tBrake + r.brake * 0.6])
        pts.push({ t: +t.toFixed(3), d: Math.round(at(t)), v: Math.round(W.sampleWarpExitRamp(r, t, out).speed) });
      return { v0: Math.round(r.v0), vArr: Math.round(r.vArr), tSlowEnd: r.tSlowEnd, tBrake: r.tBrake, tHalt: r.tHalt, pts };
    })()`);
    console.log('rampa', JSON.stringify(rampa));
    wyniki.rampaPlan = rampa;
    if (rampa) {
      // Okręt kawałek PRZED punktem z danej chwili (dziób Atlasa ~900 j. przed środkiem).
      console.log('cele rampy', JSON.stringify(await ev(SPAWN(rampa.pts.map((p) => p.d + 1200), [0]))));
      await ev(`window.__tun.on = true; true`);
      await pauza(false);
      await czekaj(`!window.warp.exitRamp?.active`, 20000);
      await pauza(true);
      wyniki.rampa = await ev(RAPORT);
      // Po zatrzymaniu — zwykły lot: Atlas mógł stanąć w kadłubie okrętu z drogi rampy (rampa bez kolizji).
      // Jak długo trwa styk i jak silnik ich rozdziela (styki, prędkości, przesunięcia, straty).
      wyniki.poRampie = [];
      await ev(`(() => { const s = window.ship; window.__tunP0 = { x: s.pos.x, y: s.pos.y, cele: window.__tunCele.map((e) => ({ x: e.x, y: e.y })) }; return true; })()`);
      await pauza(false);
      for (let k = 1; k <= 8; k++) {
        await sleep(500);
        const r = await ev(`(() => { const s = window.ship, P = window.__tunP0, log = window.__tun.log.splice(0);
          const moved = window.__tunCele.map((e, i) => Math.round(Math.hypot(e.x - P.cele[i].x, e.y - P.cele[i].y)));
          return { t: ${k * 0.5}, styki: log.length, zKim: [...new Set(log.map((q) => q.cel))], vAtlas: Math.round(Math.hypot(s.vel.x, s.vel.y)),
            atlasPrzesuniety: Math.round(Math.hypot(s.pos.x - P.x, s.pos.y - P.y)), celePrzesuniete: moved }; })()`);
        wyniki.poRampie.push(r);
        console.log('  po rampie', JSON.stringify(r));
      }
      await pauza(true);
      wyniki.poRampieStraty = await ev(RAPORT);
      wyniki.duchPoRampie = await ev(`window.ship.noHullCollisions === true`);
      console.log('  po rampie straty', JSON.stringify({ atlas: wyniki.poRampieStraty.atlas, per: wyniki.poRampieStraty.per }), 'duch', wyniki.duchPoRampie);
      // Zwykły lot wraca: Atlas 2,5 km przed okrętem, w którym stał (dziobem do niego), ciąg W przez 4 s — ma być styk.
      await ev(`(() => { const s = window.ship, c = window.__tunCele[3];
        const ang = Math.atan2(c.y - s.pos.y, c.x - s.pos.x) || 0;
        window.DevScene.teleport(c.x - Math.cos(ang) * 2500, c.y - Math.sin(ang) * 2500, ang); window.DevScene.syncCamera();
        s.vel.x = 0; s.vel.y = 0; window.camera.exitRtsMode?.(); return true; })()`);
      await pauza(false);
      await sleep(300);
      wyniki.duchPoOdlocie = await ev(`window.ship.noHullCollisions === true`);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
      await sleep(6000);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
      await pauza(true);
      wyniki.taran = await ev(RAPORT);
      console.log('  zwykły lot', JSON.stringify({ duchPoOdlocie: wyniki.duchPoOdlocie, styki: wyniki.taran.styki, zKim: wyniki.taran.okretyZeStykiem,
        predkosci: wyniki.taran.predkosciStykow, stany: wyniki.taran.stany, atlas: wyniki.taran.atlas }));
      console.log('RAMPA', JSON.stringify({ ...wyniki.rampa, log: undefined }));
      for (const r of wyniki.rampa.log.slice(0, 12)) console.log('  styk', JSON.stringify(r));
      for (const p of wyniki.rampa.per) console.log('  cel', JSON.stringify(p));
    }
    writeFileSync(join(OUT, `gra-${HZ}hz.json`), JSON.stringify(wyniki, null, 1));
    console.log('zapis:', join(OUT, `gra-${HZ}hz.json`));
  }
} finally {
  const errs = logs.filter((l) => /^\[(error|exception)\]/.test(l) && !/AudioSys/.test(l));
  if (errs.length) console.log('błędy:', errs.slice(0, 8));
  await chrome.close();
  await server.close();
}
