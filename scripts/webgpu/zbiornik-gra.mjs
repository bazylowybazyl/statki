// Wybuch okrętu ze ZBIORNIKA PALIWA (F14 audytu wybuchów, etap A2 — src/game/fuelTank.js) w PRAWDZIWEJ grze: Vite +
// headless Chrome z WebGPU (CDP), gra swobodna w pustej przestrzeni (gracz nieśmiertelny, bez mgły wojny).
//
//   node scripts/webgpu/zbiornik-gra.mjs [--tryb sceny,bitwa] [--out .tmp/zbiornik-gra] [--rozmiar 1600x900] [--port 5377]
//        [--sklad 24,10,5,1] [--zoom 0.16] [--masowe 4] [--naRaz 12] [--bitwa 30] [--ab swiatla]
//
// sceny (czas wirtualny harnessu, zrzuty na zatrzymanej klatce; A/B dawnej śmierci ↔ nowej tej samej chwili):
//   fregata / niszczyciel / pancernik — okręt w ruchu (nośnik), śmierć z puli HP: dawniej wybuch drona
//   (ShipBlastTune.fuelTank = false), teraz wybuch z gazu z miejsca zbiornika (znacznik zbiornika na kadrze 0);
//   rdzen — detonacja rdzenia pancernika (ReactorGame.forceMeltdown): obraz reactorBlast z domeną gazu w barwie frakcji
//   i bez niej (ShipBlastTune.coreGas).
// bitwa (czas rzeczywisty): najpierw --masowe par serii: --naRaz okrętów w ruchu w kadrze ginie naraz (świeże miejsce
//   na serię), 4,5 s pomiaru; potem floty z --sklad (fregaty, niszczyciele, pancerniki, supercapitale na stronę),
//   rozgrzewka --bitwa s i 8 odcinków po 6 s. Nowa / dawna śmierć NAPRZEMIENNIE (ABBA) w tym samym przebiegu (maszyna
//   jest współdzielona — porównania między przebiegami są zaszumione).
//   Liczby: czasy klatek (średnia, p95, najgorsza), domeny gazu (grid.stats.active), noSlot / reclaimed / inherited /
//   merged / gaz / cząstki, CPU kroku wybuchów.
// --ab swiatla (etap B): zawsze nowa śmierć (zbiornik), A/B ŚWIATEŁ SIATKI W DYMIE zamiast dawnej śmierci — w każdej
//   serii stan przełączany blokami po 15 klatek (te same wybuchy w obu stanach; czasy klatek liczone osobno), a 1,2 s
//   po zgonach zegar gry staje i czas GPU zatrzymanej klatki mierzony naprzemiennie z siatką i bez (mediana
//   Core3D.gpuFrameMs) — koszt marszu z pętlą świateł przy ~10 domenach.
// Raport: <out>/raport.json, pipeline'y SYNCHRONICZNE w klatkach scen (ma być 0), błędy konsoli.
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const tryby = String(args.tryb || 'sceny,bitwa').split(',');
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/zbiornik-gra');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const SKLAD = String(args.sklad || '24,10,5,1').split(',').map((v) => Math.max(0, Number(v) || 0));
const ZOOM = Number(args.zoom || 0.16);
const MASOWE = Number(args.masowe || 4);   // par serii masowych (nowa + dawna)
const NA_RAZ = Number(args.naRaz || 12);
// --zywe N (etap C): N okrętów, które NIE giną, w tym samym skupisku (ciaśniej) — kadłuby w domenach gazu (przeszkody)
const ZYWE = Number(args.zywe || 0);
const BITWA = Number(args.bitwa ?? 30);   // rozgrzewka bitwy [s] przed pomiarem (0 = bez bitwy naturalnej)
const AB_SWIATLA = args.ab === 'swiatla';
const AB_KEY = String(args.abTune || 'gridLight');   // przełącznik reżysera A/B w trybie --ab swiatla (gridLight, farGlow)

const { server, base } = await startVite(Number(args.port || 5377));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const report = { sceny: {}, bitwa: null, bledy: [] };

const stats = () => ev(`(() => {
  const x = window.__explosions; if (!x) return null;
  const s = x.stats;
  return { spawned: s.spawned, gasOnly: s.gasOnly, gas: s.gas, particles: s.particles, off: s.off, merged: s.merged, inh: s.inherited,
    recl: s.reclaimed, noSlot: s.noSlot, sec: s.secondaries, domeny: x.grid.stats.active, zrodla: x.grid.stats.sources, cpu: +s.cpuMs.toFixed(2) };
})()`);
const pipesSince = (k0) => ev(`(() => {
  const p = window.__harness.pipes.list.filter((e) => e.k >= ${k0} && !e.budowa);
  const sync = p.filter((e) => e.sync && !e.compute);
  const comp = p.filter((e) => e.compute);
  const nb = window.__harness.pipes.list.filter((e) => e.k >= ${k0} && e.budowa && !e.poza);
  return { sync: sync.length, compute: comp.length, budowyWKlatce: nb.length, lista: [...new Set(sync.map((e) => e.nazwa))].slice(0, 12),
    compLista: [...new Set(comp.map((e) => e.nazwa))].slice(0, 12), nbLista: [...new Set(nb.map((e) => e.nazwa))].slice(0, 12) };
})()`);
const frameK = () => ev('window.__harness.frameLog.n');

async function shot(name, n) {
  if (n > 0) await ev(`window.__harness.step(${n})`);
  await ev('window.__harness.frames(2)');
  await sleep(80);
  await screenshotPng(cdp, join(out, `${name}.png`));
  if (args.abKlucz) {
    // A/B tej samej klatki z wyłączonym przełącznikiem reżysera wybuchów (np. gridLight — światła siatki w dymie).
    await ev(`(async () => { window.__explosions.tune['${args.abKlucz}'] = false; await window.__harness.frames(2); return true; })()`);
    await sleep(80);
    await screenshotPng(cdp, join(out, `${name}-bez-${args.abKlucz}.png`));
    await ev(`(async () => { window.__explosions.tune['${args.abKlucz}'] = true; await window.__harness.frames(1); return true; })()`);
  }
  const st = await stats();
  console.log(name.padEnd(30), JSON.stringify(st));
  return st;
}

const camAt = (x, y, zoom) => ev(`(() => {
  const c = window.camera;
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = ${x}; c.y = c.targetY = ${y}; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  c.transition = null; window.DevScene?.syncCamera?.();
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  return true;
})()`);

// Okręt wsparcia w pustej przestrzeni: bez AI walki (nie ucieka, nie strzela), kadłub zbudowany w kadrze (gra buduje
// kadłub belkowy przy pierwszym rysunku), potem prędkość nośnika.
const SPAWN = `(key, mode, x, y, ang) => {
  const r = window.spawnCallInShip(key, { mode, spawnPos: { x, y }, pos: { x, y }, spawnAngle: ang });
  const n = Array.isArray(r) ? r[0] : r;
  if (!n) return null;
  n.combatDisabled = true; n.ai = null; n.__fogVisible = true;
  return n;
}`;

try {
  // --siatka k=v,… — konfiguracja siatek gazu przed startem (window.__EXPLOSION_GRID: A/B liczby domen i atlasu „fine”);
  // --tune k=v,… — EXPLOSION_TUNE po starcie gry (np. domainScale=5.4).
  const kv = (str) => Object.fromEntries(String(str).split(',').filter(Boolean).map((p) => { const [k, v] = p.split('='); return [k, v === 'true' ? true : v === 'false' ? false : Number(v)]; }));
  const GRID_OVR = args.siatka ? `window.__EXPLOSION_GRID = ${JSON.stringify(kv(args.siatka))};\n` : '';
  const TUNE_OVR = args.tune ? `window.__EXPLOSION_TUNE_OVR = ${JSON.stringify(kv(args.tune))};\n` : '';
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${GRID_OVR}${TUNE_OVR}(() => { try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  await waitFor(cdp, '!!window.__harness', 60000, 100);
  await ev('(() => { window.__harness.clock.mode = "real"; return true; })()');
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await sleep(800);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30 && !!window.camera && !!window.__explosions && !!window.ShipBlastTune', 300000, 400)) throw new Error('gra swobodna nie ruszyła');
  await sleep(2000);
  // Pusta przestrzeń między Wenus a Ziemią, z dala od planet i stacji; gracz nieśmiertelny; bez mgły wojny.
  const P = await ev(`(() => {
    window.setFogOfWar?.(false);
    const pl = (window.planets || []).map((p) => ({ x: p.x ?? p.pos?.x, y: p.y ?? p.pos?.y, n: p.name || p.id })).filter((p) => Number.isFinite(p.x));
    const st = (window.stations || []).map((s) => ({ x: s.x ?? s.pos?.x, y: s.y ?? s.pos?.y })).filter((p) => Number.isFinite(p.x));
    const sun = window.SUN || { x: 0, y: 0 };
    const rOf = (re) => { const p = pl.find((q) => re.test(String(q.n))); return p ? Math.hypot(p.x - sun.x, p.y - sun.y) : NaN; };
    const R = (rOf(/venus|wenus/i) + rOf(/earth|ziemia/i)) / 2;
    let best = null;
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI * 2, x = sun.x + Math.cos(a) * R, y = sun.y + Math.sin(a) * R;
      let dmin = Infinity; for (const p of pl.concat(st)) dmin = Math.min(dmin, Math.hypot(p.x - x, p.y - y));
      if (!best || dmin > best.dmin) best = { x, y, dmin };
    }
    window.DevScene.teleport(best.x, best.y, 0); window.DevScene.syncCamera();
    window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
    return { x: best.x, y: best.y };
  })()`);
  console.log('miejsce', JSON.stringify(P));

  if (tryby.includes('sceny')) {
    await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
    await ev('window.__harness.step(20)');
    const SCENY = (args.tylko ? String(args.tylko).split(',') : null);
    const SCENY_ALL = [
      ['fregata', 'frigate_pd', 'pirate', 0.42, 260],
      ['niszczyciel', 'destroyer', 'pirate', 0.3, 220],
      ['pancernik', 'pirate_battleship', 'pirate', 0.2, 160],
      ['pancernikTN', 'battleship', 'friendly', 0.2, 160]
    ];
    let slot = 0;
    for (const [name, key, mode, zoom, speed] of SCENY_ALL.filter((r) => !SCENY || SCENY.includes(r[0]))) {
      const rows = {};
      // pancernik: też strumienie z zanikiem narzucenia reżysera (0,15 s) zamiast zbiornika (0,6 s) — A/B jetVelTau
      for (const wariant of name === 'pancernik' ? ['dawna', 'nowa', 'tau015'] : ['dawna', 'nowa']) {
        const k0 = await frameK();
        // Każdy wariant w innym miejscu (domeny i dym poprzedniego nie wchodzą w kadr).
        slot++;
        const cx = P.x + 40000 * slot, cy = P.y + 30000;
        await camAt(cx, cy, zoom);
        // Gracz obok sceny (wraki daleko od gracza gra sprząta od razu), z ogniem wstrzymanym.
        await ev(`(() => { window.DevScene.teleport(${cx} - 9000, ${cy} + 6000, 0); if (window.fireControl) window.fireControl.posture = 'hold'; return true; })()`);
        await camAt(cx, cy, zoom);
        const info = await ev(`(async () => {
          const spawn = ${SPAWN};
          const ang = -0.35;
          const n = spawn('${key}', '${mode}', ${cx} - Math.cos(ang) * ${speed} * 0.5, ${cy} - Math.sin(ang) * ${speed} * 0.5, ang);
          if (!n) return null;
          window.__a2npc = n;
          for (let i = 0; i < 40 && !n.beamHull; i++) await window.__harness.step(1);
          n.angle = ang; n.desiredAngle = ang;
          n.vx = Math.cos(ang) * ${speed}; n.vy = Math.sin(ang) * ${speed};
          await window.__harness.step(10);
          const t = n.fuelTank;
          return { hull: !!n.beamHull, tank: t ? { auto: t.auto, size: +t.size.toFixed(0), profile: t.profile, cap: +t.capacity.toFixed(0) } : null,
            core: n.reactorCores?.[0]?.state ?? null };
        })()`);
        console.log(name, wariant, JSON.stringify(info));
        if (!info?.hull) { rows[wariant] = { info }; continue; }
        // Kadr 0: znacznik zbiornika (fioletowy krąg w świecie gry na kanwie 2D nie istnieje — położenie w raporcie).
        const tb = await ev(`(() => { const n = window.__a2npc; return { x: n.x, y: n.y, tank: n.fuelTank ? { gx: n.fuelTank.gx, gy: n.fuelTank.gy } : null }; })()`);
        await shot(`${name}-${wariant}-0-przed`, 0);
        await ev(`(() => { window.ShipBlastTune.fuelTank = ${wariant !== 'dawna'}; window.ShipBlastTune.jetVelTau = ${wariant === 'tau015' ? 0.15 : 0.6};
          const n = window.__a2npc;
          window.applyDamageToNPC(n, (n.hp || 1) + (n.shield?.val || 0) + 1e6, 'default', { bypassShield: true }); return true; })()`);
        const rs = [];
        let tNow = 0;
        const wrecksNear = () => ev(`(() => { const n = window.__a2npc; return (window.wrecks || []).filter((w) => Math.hypot(w.x - n.x, w.y - n.y) < 3000)
          .map((w) => ({ hull: !!w.beamHull, fog: w.__fogVisible, dead: !!w.dead, removed: !!w.removed, sleep: !!w._wreckSleeping, nodes: w.beamHull?.body?.activeNodes ?? 0 })); })()`);
        for (const at of [0.1, 0.5, 1.2, 2.5]) {
          rs.push({ t: at, ...(await shot(`${name}-${wariant}-${String(at).replace('.', '_')}`, Math.round((at - tNow) * 60))), wraki: await wrecksNear() });
          tNow = at;
        }
        console.log(name, wariant, 'wraki', JSON.stringify(rs.map((r) => r.wraki)));
        rows[wariant] = { info, tb, rows: rs, pipeline: await pipesSince(k0) };
        console.log(name, wariant, 'pipeline', JSON.stringify(rows[wariant].pipeline));
        await ev('window.ShipBlastTune.fuelTank = true; window.ShipBlastTune.jetVelTau = 0.6; window.__harness.step(300)');
      }
      report.sceny[name] = rows;
    }
    // Detonacja rdzenia pancernika: gaz w barwie frakcji ↔ bez.
    const rr = {};
    for (const wariant of (!SCENY || SCENY.includes('rdzen')) ? ['bezGazu', 'zGazem'] : []) {
      const k0 = await frameK();
      slot++;
      const cx = P.x + 40000 * slot, cy = P.y + 30000;
      await ev(`(() => { window.DevScene.teleport(${cx} - 9000, ${cy} + 6000, 0); if (window.fireControl) window.fireControl.posture = 'hold'; return true; })()`);
      await camAt(cx, cy, 0.2);
      const info = await ev(`(async () => {
        const spawn = ${SPAWN};
        const n = spawn('battleship', 'friendly', ${cx}, ${cy}, 0.4);
        if (!n) return null;
        window.__a2npc = n;
        for (let i = 0; i < 40 && !n.beamHull; i++) await window.__harness.step(1);
        n.vx = 120; n.vy = 40;
        window.ShipBlastTune.coreGas = ${wariant === 'zGazem'};
        const ok = window.ReactorGame.forceMeltdown(n, 0.05, 'shatter');
        return { hull: !!n.beamHull, ok, color: n.reactorCores?.[0]?.color };
      })()`);
      console.log('rdzen', wariant, JSON.stringify(info));
      const rs = [];
      let tNow = 0;
      for (const at of [0.2, 0.6, 1.4, 2.6]) {
        rs.push({ t: at, ...(await shot(`rdzen-${wariant}-${String(at).replace('.', '_')}`, Math.round((at - tNow) * 60))) });
        tNow = at;
      }
      rr[wariant] = { info, rows: rs, pipeline: await pipesSince(k0) };
      console.log('rdzen', wariant, 'pipeline', JSON.stringify(rr[wariant].pipeline));
      await ev('window.ShipBlastTune.coreGas = true; window.__harness.step(300)');
    }
    report.sceny.rdzen = rr;
    await ev('(() => { const h = window.__harness; h.hold(false); h.clock.mode = "real"; return true; })()');
  }

  if (tryby.includes('debug')) {
    await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
    for (const nowa of [false, true, false, true]) {
      const r = await ev(`(async () => {
        const spawn = ${SPAWN};
        const cx = ${P.x} + 90000 + Math.random() * 1e5, cy = ${P.y} - 60000;
        window.DevScene.teleport(${P.x}, ${P.y} - 60000, 0);
        const c = window.camera; c.x = c.targetX = cx; c.y = c.targetY = cy;
        const n = spawn('battleship', 'friendly', cx, cy, 0.3);
        for (let i = 0; i < 40 && !n.beamHull; i++) await window.__harness.step(1);
        n.vx = 150; n.vy = -40;
        await window.__harness.step(5);
        window.ShipBlastTune.fuelTank = ${nowa};
        const w0 = window.wrecks.length;
        let ret = 'brak';
        const orig = window.createWreckage;
        window.createWreckage = (...a) => { const r = orig(...a); ret = r ? { x: r.x, y: r.y, hull: !!r.beamHull } : r; return r; };
        let err = null;
        try { window.applyDamageToNPC(n, (n.hp || 1) + 1e7, 'default', { bypassShield: true }); } catch (e) { err = String(e.stack || e); }
        window.createWreckage = orig;
        const w1 = window.wrecks.length;
        const wr = window.wrecks.find((w) => w.beamHull && Math.hypot(w.x - n.x, w.y - n.y) < 3000);
        const track = [];
        for (const k of [1, 5, 30, 60]) { await window.__harness.step(k); track.push({ n: window.wrecks.length, inList: wr ? window.wrecks.includes(wr) : null, hull: !!wr?.beamHull, x: wr?.x, cold: (window.coldWrecks||[]).includes?.(wr) }); }
        return { nowa: ${nowa}, w0, w1, ret, err, dead: n.dead, hullNpc: !!n.beamHull, track };
      })()`);
      console.log('debug', JSON.stringify(r));
    }
  }

  if (tryby.includes('bitwa')) {
    await ev('(() => { const h = window.__harness; h.hold(false); h.clock.mode = "real"; return true; })()');
    const k0 = await frameK();
    // Pomiar odcinka: rAF w stronie, czasy klatek, przyrosty statystyk wybuchów, maks. domen.
    const measure = (label, ms, killN, newDeath) => ev(`(async () => {
      const X = window.__explosions, AB = ${AB_SWIATLA};
      window.ShipBlastTune.fuelTank = AB ? true : ${newDeath};
      X.tune['${AB_KEY}'] = true;
      const s0 = { ...X.stats };
      const cam = window.camera;
      let killed = 0;
      if (${killN} > 0) {
        // Okręty w kadrze (z kadłubem), nie myśliwce — ginie ${killN} naraz.
        const v = window.Core3D?.fx?.view;
        const inView = (n) => !v || (n.x > v.x0 && n.x < v.x1 && n.y > v.y0 && n.y < v.y1);
        const cand = window.npcs.filter((n) => n && !n.dead && n.beamHull && !n.fighter && n.__a2mass && inView(n));
        cand.sort((a, b) => Math.hypot(a.x - cam.x, a.y - cam.y) - Math.hypot(b.x - cam.x, b.y - cam.y));
        for (const n of cand.slice(0, ${killN})) { window.applyDamageToNPC(n, (n.hp || 1) + 1e7, 'default', { bypassShield: true }); killed++; }
      }
      const dts = []; let last = performance.now(); let t0 = last; let maxDom = 0, cpuSum = 0, cpuMax = 0, n = 0;
      // Przeszkody gazu (etap C): CPU pakowania po stronie gry (__gasObstStats.ms), reżysera (obstMs: wejście → scena +
      // rastry statyki) i siatki (packMs: kadłuby w uniformach domen, pasma masek); kadłuby w domenach.
      const OBT = [];   // razem gra + reżyser + siatka na klatkę (percentyle, klatki ponad budżet 0,15 ms)
      // NOWE WRAKI przy domenach gazu (widoczne we mgle): ile klatek czekały na pierwszy obrys (budżet przebudów — przegląd
      // etapu C pkt 3: wrak na końcu listy czekał w nieskończoność).
      const FPm = await import('/src/game/hullFootprint.js');
      const WWAIT = new Map(), WDONE = new Set(), WAITED = [], dR = new Float64Array(64);
      const OB = { n: 0, game: 0, gameMax: 0, apply: 0, applyMax: 0, pack: 0, packMax: 0, hulls: 0, hullsMax: 0, hullsIn: 0, nH: 0, totH: 0, totHMax: 0, dropped: 0, deferred: 0, rebuild: 0, rebuildMax: 0 };
      const dOn = [], dOff = []; let gpuAB = null, gpuDone = !AB || ${killN} <= 0;
      // GPU compute klatki w czasie rzeczywistym (A/B kroków symulacji — np. przeszkody kadłubów w kernelu reakcji)
      const gcOn = [], gcOff = [], grOn = [], grOff = [];
      while (performance.now() - t0 < ${ms}) {
        // A/B świateł siatki: blokami po 15 klatek (klatka liczona do stanu, w którym była rysowana).
        const st = !AB || Math.floor(n / 15) % 2 === 0;
        X.tune['${AB_KEY}'] = st;
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now(); dts.push(now - last); (st ? dOn : dOff).push(now - last); last = now; n++;
        { const C0 = window.Core3D; if (C0?.gpuComputeMs > 0) (st ? gcOn : gcOff).push(C0.gpuComputeMs); if (C0?.gpuFrameMs > 0) (st ? grOn : grOff).push(C0.gpuFrameMs); }
        maxDom = Math.max(maxDom, X.grid.stats.active); cpuSum += X.stats.cpuMs; cpuMax = Math.max(cpuMax, X.stats.cpuMs);
        {
          const gs = window.__gasObstStats || { ms: 0 }, gm = gs.ms || 0, am = X.stats.obstMs || 0, pm = X.grid.stats.packMs || 0, hh = X.grid.stats.hulls || 0;
          OB.n++; OB.game += gm; OB.gameMax = Math.max(OB.gameMax, gm); OB.apply += am; OB.applyMax = Math.max(OB.applyMax, am);
          OB.pack += pm; OB.packMax = Math.max(OB.packMax, pm); OB.hulls += hh; OB.hullsMax = Math.max(OB.hullsMax, hh);
          OB.hullsIn = Math.max(OB.hullsIn, X.grid.stats.hullsIn || 0); OB.dropped += gs.dropped || 0; OB.deferred += gs.deferred || 0; OB.rebuild += gs.rebuildMs || 0; OB.rebuildMax = Math.max(OB.rebuildMax, gs.rebuildMs || 0);
          OBT.push(gm + am + pm);
          {
            const nd = X.domainRects(dR);
            for (const w of (window.wrecks || [])) {
              if (!w || w.dead || !w.beamHull || WDONE.has(w) || window.SensorSystem?.hides?.(w)) continue;
              let near = false;
              for (let k = 0; k < nd && !near; k++) { const b = k * 4; near = w.x > dR[b] - 500 && w.x < dR[b + 2] + 500 && w.y > dR[b + 1] - 500 && w.y < dR[b + 3] + 500; }
              if (!near) continue;
              if (FPm.hullFootprintPeek(w, 64, 32)) { WDONE.add(w); WAITED.push(WWAIT.get(w) || 0); WWAIT.delete(w); }
              else WWAIT.set(w, (WWAIT.get(w) || 0) + 1);
            }
          }
          if (hh > 0) { OB.nH++; const tt = gm + am + pm; OB.totH += tt; OB.totHMax = Math.max(OB.totHMax, tt); }
        }
        if (!gpuDone && now - t0 > 1200) {
          // Zatrzymana klatka (~10 domen): mediana czasu GPU z siatką i bez, naprzemiennie ABBA.
          gpuDone = true;
          const h = window.__harness, C = window.Core3D;
          const pz = h.realNow();
          h.clock.t = h.realNow(); h.clock.mode = 'frozen';
          const med = async () => { const r = []; const q0 = h.realNow();
            while (h.realNow() - q0 < 1300) { await new Promise((q) => setTimeout(q, 40)); const g = C.gpuFrameMs; if (g > 0) r.push(g); }
            r.sort((a, b) => a - b); return r.length ? r[r.length >> 1] : null; };
          const on = [], off = [];
          for (const s2 of [true, false, false, true]) { X.tune['${AB_KEY}'] = s2; await new Promise((q) => setTimeout(q, 500)); (s2 ? on : off).push(await med()); }
          const mm = (a) => { const v = a.filter((x) => x != null).sort((p, q) => p - q); return v.length ? +((v[0] + v[v.length - 1]) / 2).toFixed(3) : null; };
          gpuAB = { gpuZ: mm(on), gpuBez: mm(off), domeny: X.grid.stats.active, swiatlaSiatki: C.fx?.stats?.lights ?? null };
          gpuAB.roznica = gpuAB.gpuZ != null && gpuAB.gpuBez != null ? +(gpuAB.gpuZ - gpuAB.gpuBez).toFixed(3) : null;
          h.clock.mode = 'real';
          t0 += h.realNow() - pz;   // pauza pomiaru GPU nie zjada okna serii
          last = performance.now();
        }
      }
      X.tune['${AB_KEY}'] = true;
      const stat = (a) => { if (!a.length) return null; const v = [...a].sort((p, q) => p - q);
        return { n: v.length, sr: +(v.reduce((p, q) => p + q, 0) / v.length).toFixed(3), p95: +v[Math.min(v.length - 1, Math.floor(0.95 * v.length))].toFixed(2) }; };
      const s1 = X.stats;
      const d = (k) => (s1[k] || 0) - (s0[k] || 0);
      dts.sort((a, b) => a - b);
      const q = (p) => +dts[Math.min(dts.length - 1, Math.floor(p * dts.length))].toFixed(2);
      const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
      return { label: '${label}', nowa: ${newDeath}, zgonyWymuszone: killed, wybuchy: d('spawned'), gaz: d('gas'), czastki: d('particles'), off: d('off'),
        merged: d('merged'), inh: d('inherited'), recl: d('reclaimed'), noSlot: d('noSlot'), sec: d('secondaries'), gasOnly: d('gasOnly'),
        klatki: n, sredniaMs: +avg.toFixed(2), p95: q(0.95), najgorszaMs: +dts[dts.length - 1].toFixed(1), maxDomen: maxDom,
        cpuKrokuSr: +(cpuSum / n).toFixed(3), cpuKrokuMax: +cpuMax.toFixed(2),
        przeszkody: { graSr: +(OB.game / OB.n).toFixed(4), graMax: +OB.gameMax.toFixed(3), rezSr: +(OB.apply / OB.n).toFixed(4), rezMax: +OB.applyMax.toFixed(3),
          siatkaSr: +(OB.pack / OB.n).toFixed(4), siatkaMax: +OB.packMax.toFixed(3), kadlubySr: +(OB.hulls / OB.n).toFixed(1), kadlubyMax: OB.hullsMax, kadlubyWejscie: OB.hullsIn,
          klatkiZKadlubami: OB.nH, razemZKadlubamiSr: OB.nH ? +(OB.totH / OB.nH).toFixed(4) : null, razemZKadlubamiMax: +OB.totHMax.toFixed(3), poza: OB.dropped,
          odlozone: OB.deferred, obrysySr: +(OB.rebuild / OB.n).toFixed(4), obrysyMax: +OB.rebuildMax.toFixed(3),
          ...(() => { const v = OBT.sort((p, q) => p - q); const at = (f) => (v.length ? +v[Math.min(v.length - 1, Math.floor(f * v.length))].toFixed(3) : null);
            return { razemP50: at(0.5), razemP99: at(0.99), razemMax: v.length ? +v[v.length - 1].toFixed(3) : null, ponad015: v.filter((x) => x > 0.15).length }; })(),
          wrakiObrys: { n: WAITED.length, czekaMax: WAITED.length ? Math.max(...WAITED) : 0,
            czekaSr: WAITED.length ? +(WAITED.reduce((p, q) => p + q, 0) / WAITED.length).toFixed(2) : 0,
            bezObrysu: WWAIT.size, bezObrysuMaxKlatek: WWAIT.size ? Math.max(...WWAIT.values()) : 0 } },
        npc: window.npcs.filter((x) => !x.dead).length, wraki: (window.wrecks || []).length,
        ...(AB ? { swiatlaZ: stat(dOn), swiatlaBez: stat(dOff), gpuAB, computeZ: stat(gcOn), computeBez: stat(gcOff), gpuKlatkiZ: stat(grOn), gpuKlatkiBez: stat(grOff) } : {}) };
    })()`);
    // MASOWE ZGONY (kontrolowane A/B): --naRaz okrętów (fregaty, niszczyciele, pancerniki) w ruchu w kadrze ginie naraz,
    // 4,5 s pomiaru; każda seria w świeżym miejscu (wraki poprzedniej sprząta gra — daleko od gracza); kolejność ABBA.
    const masowe = [];
    const ORDER = [true, false, false, true, true, false, false, true].slice(0, MASOWE * 2);
    for (let i = 0; i < ORDER.length; i++) {
      const mx = P.x + 300000 + 70000 * i, my = P.y + 250000;
      await ev(`(async () => {
        window.DevScene.teleport(${mx} - 6000, ${my} + 5000, 0); if (window.fireControl) window.fireControl.posture = 'hold';
        const c = window.camera; if (c.mode !== 'rts' && c.enterRtsMode) c.enterRtsMode();
        c.x = c.targetX = ${mx}; c.y = c.targetY = ${my}; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${ZOOM}; c.transition = null;
        document.getElementById('cockpit-ui-host')?.classList.add('hidden');
        const spawn = ${SPAWN};
        const keys = ['frigate_pd', 'destroyer', 'pirate_battleship', 'frigate_laser', 'battleship', 'destroyer'];
        const N = ${NA_RAZ};
        for (let k = 0; k < ${ZYWE}; k++) {
          const a = (k / Math.max(1, ${ZYWE})) * Math.PI * 2 + 0.4, r = 700 + (k % 4) * 650;
          const n = spawn(keys[(k + 1) % keys.length], k % 2 ? 'pirate' : 'friendly', ${mx} + Math.cos(a) * r, ${my} + Math.sin(a) * r * 0.7, a - 0.8);
          if (n) n.__a2keep = true;
        }
        for (let k = 0; k < N; k++) {
          const a = (k / N) * Math.PI * 2, r = 1800 + (k % 3) * 900;
          const n = spawn(keys[k % keys.length], k % 2 ? 'friendly' : 'pirate', ${mx} + Math.cos(a) * r, ${my} + Math.sin(a) * r * 0.6, a + 1.2);
          if (n) { n.__a2mass = true; window.__a2massN = (window.__a2massN || 0) + 1; }
        }
        return true;
      })()`);
      await sleep(2500);   // kadłuby budują się przy pierwszych rysunkach
      await ev(`(() => { for (const n of window.npcs) if ((n.__a2mass || n.__a2keep) && !n.dead) { const a = Math.random() * 6.283; n.vx = Math.cos(a) * 180; n.vy = Math.sin(a) * 180; } return true; })()`);
      const r = await measure(`masowe ${i}`, 4500, NA_RAZ, ORDER[i]);
      masowe.push(r); console.log('masowe', JSON.stringify(r));
      await sleep(1500);
    }
    if (AB_SWIATLA) {
      const L = masowe.map((r) => r.gpuAB).filter((g) => g && g.roznica != null);
      const avg = (k) => +(L.reduce((p, g) => p + g[k], 0) / Math.max(1, L.length)).toFixed(3);
      const W = (k) => { const a = masowe.map((r) => r[k]).filter(Boolean); return { sr: +(a.reduce((p, q) => p + q.sr * q.n, 0) / Math.max(1, a.reduce((p, q) => p + q.n, 0))).toFixed(3),
        p95: +(a.reduce((p, q) => p + q.p95, 0) / Math.max(1, a.length)).toFixed(2) }; };
      report.swiatla = { gpuZ: avg('gpuZ'), gpuBez: avg('gpuBez'), roznica: avg('roznica'), domenySr: avg('domeny'), klatkiZ: W('swiatlaZ'), klatkiBez: W('swiatlaBez') };
      console.log('ŚWIATŁA SIATKI W DYMIE (masowe)', JSON.stringify(report.swiatla));
    }
    if (BITWA <= 0) { report.bitwa = { masowe }; throw Object.assign(new Error('koniec (bez bitwy naturalnej)'), { koniec: true }); }
    const [NF, ND, NB, NS] = SKLAD;
    const bx = P.x - 200000, by = P.y - 150000;
    await ev(`(() => { window.DevScene.teleport(${bx}, ${by}, 0); window.DevScene.syncCamera(); return true; })()`);
    await sleep(1500);
    const sp = await ev(`(() => {
      const s = window.ship, a = 0, c = Math.cos(a), n = Math.sin(a);
      const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
      const out = { piraci: 0, tn: 0 };
      const put = (key, mode, pos, ang) => { const r = window.spawnCallInShip(key, { mode, spawnPos: pos, pos, spawnAngle: ang });
        const k = Array.isArray(r) ? r.length : (r ? 1 : 0); if (mode === 'pirate') out.piraci += k; else out.tn += k; };
      const block = (key, mode, k, fwd0, rowGap, spacing, perRow, dir, ang) => {
        for (let i = 0; i < k; i++) { const row = Math.floor(i / perRow), inRow = Math.min(perRow, k - row * perRow), j = i - row * perRow;
          put(key, mode, at(fwd0 + dir * row * rowGap, (j - (inRow - 1) / 2) * spacing), ang); } };
      block('frigate_pd', 'pirate', ${NF}, 7000, 700, 650, 25, 1, a + Math.PI);
      block('destroyer', 'pirate', ${ND}, 8600, 900, 900, 20, 1, a + Math.PI);
      block('pirate_battleship', 'pirate', ${NB}, 10600, 1500, 1500, 10, 1, a + Math.PI);
      block('pirate_supercapital', 'pirate', ${NS}, 13500, 3500, 4000, 5, 1, a + Math.PI);
      block('frigate_laser', 'friendly', ${NF}, -1500, 700, 650, 25, -1, a);
      block('destroyer', 'friendly', ${ND}, -3100, 900, 900, 20, -1, a);
      block('battleship', 'friendly', ${NB}, -5100, 1500, 1500, 10, -1, a);
      block('supercapital', 'friendly', ${NS}, -8000, 3500, 4000, 5, -1, a);
      const cam = window.camera; if (cam.mode !== 'rts' && cam.enterRtsMode) cam.enterRtsMode();
      cam.x = cam.targetX = s.pos.x + 4500; cam.y = cam.targetY = s.pos.y; cam.manualZoom = true; cam.zoom = cam.targetZoom = cam.zoomBase = ${ZOOM};
      document.getElementById('cockpit-ui-host')?.classList.add('hidden');
      return out;
    })()`);
    console.log('bitwa spawn', JSON.stringify(sp));
    const res = { spawn: sp, odcinki: [], masowe };
    // Bitwa naturalna: rozgrzewka (floty się zbliżają), potem odcinki po 6 s, nowa / dawna śmierć na przemian (ABBA).
    await sleep(Math.max(0, BITWA) * 1000);
    const SEG = [true, false, false, true, true, false, false, true];
    for (let i = 0; i < SEG.length; i++) {
      const r = await measure(`bitwa ${i}`, 6000, 0, SEG[i]);
      res.odcinki.push(r); console.log('odcinek', JSON.stringify(r));
    }
    res.pipeline = await pipesSince(k0);
    console.log('bitwa pipeline', JSON.stringify(res.pipeline));
    const sum = (list, nowa) => {
      const L = list.filter((r) => r.nowa === nowa);
      const a = (k) => +(L.reduce((s, r) => s + r[k], 0) / Math.max(1, L.length)).toFixed(3);
      const t = (k) => L.reduce((s, r) => s + r[k], 0);
      return { n: L.length, sredniaMs: a('sredniaMs'), p95: a('p95'), najgorszaMs: Math.max(...L.map((r) => r.najgorszaMs)),
        cpuKrokuSr: a('cpuKrokuSr'), cpuKrokuMax: Math.max(...L.map((r) => r.cpuKrokuMax)), maxDomen: Math.max(...L.map((r) => r.maxDomen)),
        wybuchy: t('wybuchy'), gaz: t('gaz'), czastki: t('czastki'), noSlot: t('noSlot'), recl: t('recl'), inh: t('inh'), merged: t('merged'), gasOnly: t('gasOnly') };
    };
    res.podsumowanie = { odcinkiNowa: sum(res.odcinki, true), odcinkiDawna: sum(res.odcinki, false), masoweNowa: sum(res.masowe, true), masoweDawna: sum(res.masowe, false) };
    console.log('PODSUMOWANIE', JSON.stringify(res.podsumowanie, null, 1));
    report.bitwa = res;
  }
} catch (err) {
  if (!err?.koniec) {
    report.wyjatek = String(err?.stack || err);
    console.error(err);
    report.logi = logs.all().slice(-60);
  }
} finally {
  // Kolizje uuid węzłów TSL (pułapka 38 — węzeł z kodem starszego węzła; ma być 0). Skrypt nie robi reseed.
  try { report.tslUuid = await ev('(() => { const u = window.Core3D?.tslUuid; return u ? { kolizje: u.kolizje } : null; })()'); console.log('tslUuid', JSON.stringify(report.tslUuid)); } catch { /* strona padła */ }
  report.bledy = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools|powerPreference|Unable to decode audio|AudioSys/.test(l)).slice(0, 60);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.slice(0, 20).join('\n'));
  writeJson(join(out, 'raport.json'), report);
  console.log('wyniki', out);
  await chrome.close();
  await server.close();
  process.exit(0);
}
