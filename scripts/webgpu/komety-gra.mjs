// Komety (src/data/comets.js, src/game/cometField.js, src/3d/comets/) w PRAWDZIWEJ grze: gra swobodna, kamera RTS
// na każdej komecie — z daleka (zoom gry 0,035 i oddalenie dokumentacyjne całych warkoczy), średnio (głowa), jądro
// z bliska; mgła wojny (kometa = teren), radar kokpitu przy komecie, mapa CIC (widok układu), W SKOKU (TRAVEL TO przez
// warkocz — rulon gnie arkusz), kolizja kadłuba z jądrem (statek nie wchodzi w obrys), pociski gasną w jądrze,
// pipeline'y synchroniczne w klatkach gry (ma być 0), błędy konsoli.
//
//   node scripts/webgpu/komety-gra.mjs [--out .tmp/komety/gra] [--tylko halley,67p] [--skok 0] [--rozmiar 1600x900]
//                                      [--koszt 1 [--tylkoKoszt 1]]   (koszt GPU: mediana Core3D.gpuFrameMs, komety
//                                      wł. ↔ wył. naprzemiennie ABAB w trzech kadrach — tylko po START do innych sesji)
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/komety/gra');
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
const doJump = String(args.skok ?? '1') !== '0';
const doCost = String(args.koszt ?? '0') === '1';
const onlyCost = doCost && String(args.tylkoKoszt ?? '0') === '1';
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5441));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { komety: null, zrzuty: {}, kolizja: null, pociski: null, skok: null };

async function shot(name, opis) {
  await ev('window.__harness.frames(3)');
  await screenshotPng(cdp, join(out, `${name}.png`));
  const st = await ev(`(() => ({ zoom: +window.camera.zoom.toFixed(4), widoczne: window.__cometsView ? { ...window.__cometsView.stats } : null,
    gpuMs: +(Number(window.Core3D?.gpuFrameMs) || 0).toFixed(3) }))()`);
  report.zrzuty[name] = { opis, ...st };
  console.log('zrzut', name.padEnd(30), JSON.stringify(st));
}

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  const begLog = await ev('window.__harness.frameLog.n');
  report.komety = await ev(`(() => (window.CometField ? window.CometField.sites.map((s) => ({ id: s.id, ready: s.ready, x: Math.round(s.x), y: Math.round(s.y),
    rAu: +s.state.rAu.toFixed(3), rMap: +s.state.rMap.toFixed(2), aktywnosc: +s.geo.activity.toFixed(4), jonowyKm: Math.round(s.geo.ionLen / 1000),
    pylowyKm: Math.round(s.geo.dustLen / 1000), komaKm: Math.round(s.geo.comaR / 1000), obrysKm: +(s.reach / 1000).toFixed(2),
    odZiemiAU: +((() => { const e = planets.find((p) => p.id === 'earth'); return Math.hypot(e.x - s.x, e.y - s.y) / window.AU_IN_WORLD_UNITS; })()).toFixed(1),
    // odległość od gęstych pól pasa (AU, < 0 = na zewnątrz) — rozstawienie omija je z zapasem komy + 1,5 AU
    pasAU: (() => { const f = window.__asteroidBelt?.field; if (!f) return null;
      return +(f.penetrationOf(['main', 'hildas', 'greeks', 'trojans', 'kuiper', 'plutinos', 'kuiper_cold', 'hungarias'], s.x, s.y) / window.AU_IN_WORLD_UNITS).toFixed(2); })() })) : null))()`);
  console.log('komety:', JSON.stringify(report.komety), 'bez miejsca:', JSON.stringify(await ev('window.CometField ? window.CometField.stats.blocked : null')));
  if (!report.komety) throw new Error('brak window.CometField');
  for (let i = 0; i < 200 && !(await ev('window.CometField.sites.every((s) => s.ready)')); i++) await ev('window.__harness.frames(2)');

  await ev('window.__harness.frames(4)');
  await ev('window.__harness.hold(true)');
  await ev('window.__harness.scene.hideHud(true)');
  await ev('(() => { window.camera.minZoom = 0.002; window.camera.maxZoom = 8; return true; })()');

  const first = report.komety.find((c) => !only || only.has(c.id)) || report.komety[0];

  // KOSZT GPU (po uzgodnieniu START / KONIEC z innymi sesjami): mediana Core3D.gpuFrameMs z 60 próbek, komety
  // włączone ↔ wyłączone (arkusz i jądro — CometTune), naprzemiennie ABAB, w trzech kadrach tej samej komety.
  if (doCost) {
    await ev('(() => { window.setFogOfWar?.(false); return true; })()');
    const g = await ev(`(() => { const s = window.CometField.sites.find((q) => q.id === '${first.id}'); const q = s.geo; return { ax: q.ax, ay: q.ay, coma: q.comaR, R: s.reach, L: Math.max(q.ionLen, q.dustLen) }; })()`);
    const views = [
      ['zoom gry 0,035 (głowa i warkocze na cały kadr)', first.x + g.ax * 14000, first.y + g.ay * 14000, 0.035],
      ['jądro z bliska', first.x, first.y, H / (g.R * 3.4)],
      ['cała kometa (oddalenie)', first.x + g.ax * g.L * 0.45, first.y + g.ay * g.L * 0.45, Math.min(W, H) / (g.L * 1.25)]
    ];
    const gpu = async (on) => {
      await ev(`(() => { window.CometTune.sheet = ${on}; window.CometTune.nucleus = ${on}; return true; })()`);
      await ev('window.__harness.frames(8)');
      const v = [];
      for (let i = 0; i < 60; i++) {
        await ev('window.__harness.frames(2)');
        const x = await ev('window.Core3D?.gpuFrameMs ?? 0');
        if (x > 0) v.push(x);
      }
      v.sort((a, b) => a - b);
      return v.length ? +v[v.length >> 1].toFixed(3) : null;
    };
    report.koszt = [];
    for (const [name, x, y, z] of views) {
      await ev(`window.__harness.scene.cam(${x}, ${y}, ${z})`);
      await gpu(true);   // seria rozgrzewająca (pierwsze klatki kadru — wysyłki, pamięć podręczna) — odrzucona
      const a1 = await gpu(true), a0 = await gpu(false), b1 = await gpu(true), b0 = await gpu(false);
      const row = { kadr: name, zoom: +z.toFixed(4), wl: [a1, b1], wyl: [a0, b0], roznicaMs: +(((a1 + b1) - (a0 + b0)) / 2).toFixed(3) };
      report.koszt.push(row);
      console.log('koszt GPU:', JSON.stringify(row));
    }
    await ev('(() => { window.CometTune.sheet = true; window.CometTune.nucleus = true; window.setFogOfWar?.(true); return true; })()');
  }
  if (onlyCost) throw Object.assign(new Error('tylko koszt'), { quiet: true });

  // Mgła wojny: komety daleko od gracza — w mgle (przygaszone, ale rysowane jak teren)
  await ev(`window.__harness.scene.cam(${first.x}, ${first.y}, 0.035)`);
  await ev('window.__harness.frames(6)');
  await shot(`${first.id}-00-mgla-wojny`, 'Z mgłą wojny (domyślnie): kometa poza wzrokiem — teren, przygaszony');
  await ev('(() => { window.setFogOfWar?.(false); return true; })()');

  for (const c of report.komety) {
    if (only && !only.has(c.id)) continue;
    const geo = await ev(`(() => { const s = window.CometField.sites.find((q) => q.id === '${c.id}'); const g = s.geo;
      return { ax: g.ax, ay: g.ay, ion: g.ionLen, dust: g.dustLen, coma: g.comaR, R: s.reach, active: g.active }; })()`);
    const L = Math.max(geo.ion, geo.dust);
    if (geo.active) {
      // oddalenie dokumentacyjne: cała kometa (warkocze ~AU mapy)
      const cx = c.x + geo.ax * L * 0.45, cy = c.y + geo.ay * L * 0.45;
      const z = Math.min(W / (L * 1.25), H / (L * 1.25));
      await ev(`window.__harness.scene.cam(${cx}, ${cy}, ${z})`);
      await shot(`${c.id}-01-cala`, `Cała kometa (zoom ${z.toFixed(4)} — poza zakresem gry, dokumentacja warkoczy)`);
    }
    await ev(`window.__harness.scene.cam(${c.x + geo.ax * 14000}, ${c.y + geo.ay * 14000}, 0.035)`);
    await shot(`${c.id}-02-z-daleka`, 'Najdalszy zoom gry (0,035)');
    await ev(`window.__harness.scene.cam(${c.x + geo.ax * geo.coma * 0.3}, ${c.y + geo.ay * geo.coma * 0.3}, ${Math.max(0.035, H / (Math.max(geo.coma, geo.R * 3) * 3))})`);
    await shot(`${c.id}-03-srednio`, 'Głowa: koma, dżety, nasada warkoczy');
    await ev(`window.__harness.scene.cam(${c.x}, ${c.y}, ${H / (geo.R * 3.4)})`);
    await shot(`${c.id}-04-jadro`, 'Jądro z bliska');
  }

  // Radar kokpitu i mapa CIC: statek przy komecie (HUD widoczny)
  {
    const c = first;
    await ev(`(() => { const s = window.CometField.sites.find((q) => q.id === '${c.id}'); window.DevScene.teleport(s.x - s.geo.ax * (s.reach + 9000), s.y - s.geo.ay * (s.reach + 9000), Math.atan2(s.geo.ay, s.geo.ax)); return true; })()`);
    await ev('window.__harness.scene.shipCam(0.08)');
    await ev('window.__harness.scene.hideHud(false)');
    await ev('window.__harness.step(90, 1000 / 60)');
    report.radarDiag = await ev(`(() => { const s = window.CometField.sites.find((q) => q.id === '${c.id}');
      return { statek: [Math.round(window.ship.pos.x), Math.round(window.ship.pos.y)], kamera: [Math.round(window.camera.x), Math.round(window.camera.y), +window.camera.zoom.toFixed(4), window.camera.mode],
        jadro: [Math.round(s.x), Math.round(s.y)], odleglosc: Math.round(Math.hypot(window.ship.pos.x - s.x, window.ship.pos.y - s.y)), widoczne: { ...window.__cometsView.stats } }; })()`);
    console.log('radar diag:', JSON.stringify(report.radarDiag));
    await shot(`${c.id}-05-radar`, 'Kokpit przy komecie: podkład radaru (jądro, koma, warkocze)');
    await ev(`(() => { window.runGameAction('ui.cicMap'); return true; })()`);
    await ev('window.__harness.step(40, 1000 / 60)');
    await ev(`(() => { window.runGameAction('cic.systemView'); return true; })()`);
    await ev('window.__harness.step(120, 1000 / 60)');
    await shot(`${c.id}-06-cic`, 'Mapa CIC (widok układu): komety z orbitami i warkoczami');
    await ev(`(() => { window.runGameAction('ui.cicMap'); return true; })()`);
    await ev('window.__harness.scene.hideHud(true)');
  }

  // Kolizja: statek gracza postawiony Z ZAKŁADKĄ na obrysie jądra (środek 300 j. w głąb, prędkość w głąb) — po krokach
  // fizyki ma być wypchnięty: środek poza obrysem, kolizje policzone, prędkość w głąb odbita
  {
    const c = first;
    report.kolizja = {};
    const setup = await ev(`(() => {
      const f = window.CometField, s = f.sites.find((q) => q.id === '${c.id}');
      const dx = -s.geo.ay, dy = s.geo.ax;   // z boku jądra
      const r0 = f.outlineRadius(s, dx, dy);
      window.DevScene.teleport(s.x + dx * (r0 - 300), s.y + dy * (r0 - 300), Math.atan2(dy, dx) + Math.PI / 2);
      window.ship.vel.x = -dx * 400; window.ship.vel.y = -dy * 400;
      return { kolizje0: f.stats.collisions, przed: Math.round(-300) };
    })()`);
    await ev('window.__harness.step(8, 1000 / 60)');
    report.kolizja = await ev(`(() => { const f = window.CometField, s = f.sites.find((q) => q.id === '${c.id}');
      const gx = window.ship.pos.x - s.x, gy = window.ship.pos.y - s.y;
      const dx = -s.geo.ay, dy = s.geo.ax;
      return { odstepPrzed: ${setup.przed}, odstepPo: Math.round(Math.hypot(gx, gy) - f.outlineRadius(s, gx, gy)),
        kolizje: f.stats.collisions - ${setup.kolizje0}, vWGlab: Math.round(-(window.ship.vel.x * dx + window.ship.vel.y * dy)),
        polSzerKadluba: Math.round((window.ship.h || 0) * 0.46) }; })()`);
    console.log('kolizja:', JSON.stringify(report.kolizja));
    report.pociski = await ev(`(() => { const f = window.CometField, s = f.sites.find((q) => q.id === '${c.id}');
      return { wSrodku: f.pointBlocked(s.x, s.y), obok: f.pointBlocked(s.x + s.reach * 1.2, s.y) }; })()`);
  }

  // W SKOKU: TRAVEL TO przez warkocz (kurs prostopadły — przecięcie w 0,3 długości) i wzdłuż warkocza (start 2 AU przed
  // głową od strony Słońca, z boku o pół promienia komy, cel 2 AU za końcem). Kroki harnessu, zrzut, gdy statek jest
  // w skoku przy punkcie zainteresowania (albo właśnie go mija).
  if (doJump) {
    const c = report.komety.find((q) => q.aktywnosc > 0.05 && (!only || only.has(q.id))) || first;
    report.skok = {};
    for (const mode of ['przez', 'wzdluz']) {
      const plan = await ev(`(() => {
        const s = window.CometField.sites.find((q) => q.id === '${c.id}'), g = s.geo, au = window.AU_IN_WORLD_UNITS;
        const L = Math.max(g.ionLen, g.dustLen);
        const nx = -g.ay, ny = g.ax;
        let a, b, px, py;
        if ('${mode}' === 'przez') {
          px = s.x + g.ax * L * 0.3; py = s.y + g.ay * L * 0.3;
          a = { x: px - nx * 3 * au, y: py - ny * 3 * au }; b = { x: px + nx * 3 * au, y: py + ny * 3 * au };
        } else {
          const off = g.comaR * 0.5;
          px = s.x + g.ax * L * 0.35 + nx * off; py = s.y + g.ay * L * 0.35 + ny * off;
          a = { x: s.x - g.ax * 2 * au + nx * off, y: s.y - g.ay * 2 * au + ny * off };
          b = { x: s.x + g.ax * (L + 2 * au) + nx * off, y: s.y + g.ay * (L + 2 * au) + ny * off };
        }
        window.DevScene.teleport(a.x, a.y, Math.atan2(b.y - a.y, b.x - a.x));
        window.DevFlags && (window.DevFlags.unlimitedWarp = true);
        return { a, b, px, py };
      })()`);
      await ev('window.__harness.scene.shipCam(0.05)');
      await ev('window.__harness.step(30, 1000 / 60)');
      await ev(`window.setTravelTarget(${plan.b.x}, ${plan.b.y}, 'TEST KOMETA')`);
      let at = null;
      let prevD = Infinity;
      for (let k = 0; k < 2400 && !at; k++) {
        await ev('window.__harness.step(1, 1000 / 60)');
        const st = await ev(`(() => ({ w: window.warp.state, d: Math.hypot(window.ship.pos.x - ${plan.px}, window.ship.pos.y - ${plan.py}) }))()`);
        if (st.w === 'active' && (st.d < 40000 || (st.d > prevD && st.d < 150000))) at = mode;
        prevD = st.d;
      }
      if (at) {
        await screenshotPng(cdp, join(out, `${c.id}-07-w-skoku-${mode}.png`));
        report.skok[mode] = await ev(`(async () => { const { RULON } = await import('/src/3d/warp/rulon.js');
          return { warp: window.warp.state, v: Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y)), rulonK: +RULON.k.value.toExponential(2), zoom: +window.camera.zoom.toFixed(4), widoczne: { ...window.__cometsView.stats } }; })()`);
        console.log(`skok ${mode}:`, JSON.stringify(report.skok[mode]));
      } else {
        report.skok[mode] = { blad: 'statek nie doleciał do punktu w skoku (2400 klatek)', travel: await ev('window.__travelDebug?.()') };
        console.log(`skok ${mode}: BRAK`, JSON.stringify(report.skok[mode]).slice(0, 400));
      }
      // podróż kończy się sama w celu (wyjście z warpa rampą) — przed następnym kursem
      for (let k = 0; k < 500; k++) {
        await ev('window.__harness.step(4, 1000 / 60)');
        if (await ev("!window.travelNav?.active && window.warp.state === 'idle' && !window.warp.isBusy?.()")) break;
      }
    }
  }

  report.pipeline = (await ev(`window.__harness.frameStats(${begLog})`)).pipeline;
  console.log('pipeline:', JSON.stringify({ sync: report.pipeline?.sync, syncLista: report.pipeline?.syncLista }));
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 20);
} catch (e) {
  if (!e?.quiet) {
    report.blad = String(e?.stack || e);
    console.log('BŁĄD', report.blad);
  }
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
console.log('błędy strony:', (report.bledy || []).length, (report.bledy || []).slice(0, 5).join(' | '));
process.exit(report.blad ? 1 : 0);
