// SCENA „HOLOWANIE” w PRAWDZIWEJ grze (E24, `?scena=holowanie`): plac wraków przy Ziemi, złomiarz NPC holuje cały
// kadłub, drugi tnie odłamy, wrak znika z holownikiem na lejku ringu. Zrzuty sekwencji (plac, przylot, lina, hol,
// zrzut, cięcie, po cięciu) w kadrze sceny i z bliska, film GIF holu, prędkość holownika w holu, dziennik sceny,
// pipeline'y synchroniczne i błędy konsoli — dla każdej prędkości holu po kolei (`?hol=`).
// Vite + headless Chrome z WebGPU (CDP), gra swobodna, zegar krokowy harnessu.
//
//   node scripts/webgpu/holowanie-gra.mjs [--hol 1200,wolny] [--query renderWorker=1] [--out .tmp/holowanie]
//        [--port 5483] [--limit-gry 420] [--film 1]
//
// Wynik: <out>/<hol>/raport.json, zrzuty <out>/<hol>/*.png, film <out>/<hol>/hol.gif; zbiorczo <out>/raport.json.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const outRoot = resolve(repo, args.out || '.tmp/holowanie');
mkdirSync(outRoot, { recursive: true });
const query = `&${args.query || 'renderWorker=1'}`;
const SPEEDS = String(args.hol || '1200,wolny').split(',').filter(Boolean);
const GAME_LIMIT = Number(args['limit-gry'] || 420);
const FILM = args.film !== '0';
// Proporcje ekranu gracza (5120 × 1440, 32:9) w połowie rozdzielczości — kadr sceny jak u niego.
const WIDTH = Number(args.szer || 2560);
const HEIGHT = Number(args.wys || 720);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5483));
const all = { query, przebiegi: {} };

async function runSpeed(hol) {
  const out = join(outRoot, hol);
  mkdirSync(out, { recursive: true });
  const chrome = await startChrome({ width: WIDTH, height: HEIGHT });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 180000) => evaluate(cdp, e, t);
  const report = { hol, query, zrzuty: [], zdarzenia: [] };
  const workerLogs = [];
  let msgId = 900000;
  cdp.on((msg) => {
    if (msg.method === 'Target.attachedToTarget') {
      const sessionId = msg.params.sessionId;
      for (const method of ['Runtime.enable', 'Runtime.runIfWaitingForDebugger']) cdp.ws.send(JSON.stringify({ id: ++msgId, method, sessionId }));
    }
    if (msg.sessionId && msg.method === 'Runtime.consoleAPICalled') {
      workerLogs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 4000));
    }
    if (msg.sessionId && msg.method === 'Runtime.exceptionThrown') {
      workerLogs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`.slice(0, 4000));
    }
  });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  const syncWorker = () => workerLogs.filter((l) => l.includes('pipeline sync')).map((l) => l.replace(/^.*pipeline sync #\d+ k=\d+: /, ''));
  const syncPage = () => ev(`(() => { const p = window.__harness && window.__harness.pipes; return p ? p.list.filter((e) => e.sync).map((e) => e.nazwa) : []; })()`);
  const step = (n) => ev(`window.__harness.step(${Math.max(1, Math.round(n))}).then(() => true)`, 600000);
  let gameT = 0;
  const shot = async (name, opis) => {
    const file = join(out, `${name}.png`);
    await screenshotPng(cdp, file);
    report.zrzuty.push({ plik: file, opis, t: Math.round(gameT * 10) / 10 });
    console.log(`  [${hol}] zrzut ${name} (t=${gameT.toFixed(1)} s): ${opis}`);
  };
  // Zbliżenie: kamera RTS nad punktem (wysokość kadru h j.), zrzut, powrót do kadru sceny.
  const closeUp = async (name, opis, p, h) => {
    if (!p) return;
    await ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, 0.003); c.manualZoom = true;
      c.x = c.targetX = ${p.x}; c.y = c.targetY = ${p.y}; c.zoom = c.targetZoom = c.zoomBase = ${(HEIGHT / h).toFixed(4)};
      c.zoomVel = 0; window.DevScene.syncCamera(); return true; })()`);
    await step(6);
    await shot(name, opis);
    await ev('window.DevScene.holowanieKadr()');
    await step(6);
  };
  // Holownik w drodze po wrak sceny (rekord pracy encji jest dopiero od postoju): kurs z przeglądu prac workera.
  const inbound = async (gid) => ev(`window.TrafficV2.requestSnapshot().then((s) => {
    const w = (s.work || []).find((x) => x.gid === ${gid}); if (!w) return null;
    const a = window.TrafficBubble.byId.get(w.course);
    return { course: w.course, phase: w.phase, kind: w.kind, unit: w.unitClass, spot: { x: Math.round(w.x), y: Math.round(w.y) },
      tug: a ? { x: Math.round(a.cx), y: Math.round(a.cy), v: Math.round(Math.sqrt(a.vx * a.vx + a.vy * a.vy)), faza: a.phase, hull: a.hullId } : null };
  })`);
  const state = () => ev(`(() => {
    const S = window.TowScene, ts = window.TrafficSalvage, tb = window.TrafficBubble, br = window.TrafficV2;
    if (!S) return null;
    const works = [...br.actorWorks.values()].filter((w) => w.gid != null).map((w) => {
      const a = tb.byId.get(w.id); const j = ts.jobs.get(w.id); const k = j && j.wreck;
      return { id: w.id, gid: w.gid, kind: w.kind, phase: w.phase,
        tug: a ? { x: Math.round(a.cx), y: Math.round(a.cy), v: Math.round(Math.sqrt(a.vx * a.vx + a.vy * a.vy)), faza: a.phase, kat: +a.ca.toFixed(2), kurs: +Math.atan2(a.vy, a.vx).toFixed(2) } : null,
        rope: !!(j && j.rope), cut: j ? j.cut0 || 0 : 0, active: !!(j && j.active),
        wrak: k ? { x: Math.round(k.x), y: Math.round(k.y), r: Math.round(k.radius || 0), v: Math.round(Math.sqrt((k.vx || 0) ** 2 + (k.vy || 0) ** 2)),
          wezly: k.beamHull?.body?.activeNodes ?? null } : null };
    });
    const rep = [...ts.reported.values()].map((r) => ({ gid: r.gid, x: Math.round(r.wreck.x), y: Math.round(r.wreck.y), r: Math.round(r.wreck.radius || 0) }));
    return { faza: S.phase, t: S.t, current: S.current, queue: S.queue.map((w) => w.gid), released: S.released.slice(), works, rep,
      spot: S.spot, u: S.u, earth: S.earth || null, npc: npcNear() };
    function npcNear() {
      const p = window.ship && window.ship.pos; if (!p) return [];
      return (window.npcs || []).filter((n) => n && !n.dead && Math.sqrt((n.x - p.x) ** 2 + (n.y - p.y) ** 2) < 15000).map((n) => ({
        id: String(n.id).slice(0, 40), typ: n.type, kadlub: n.shipFrame || null, frakcja: n.factionId || n.faction || null, pirat: !!n.isPirate,
        sojusz: !!n.friendly, kurs: n.trafficCourse ?? null, uraza: !!n.playerGrudge, km: +(Math.sqrt((n.x - p.x) ** 2 + (n.y - p.y) ** 2) / 1000).toFixed(2) }));
    }
  })()`);

  try {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
      localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
    } catch {} })();\nwindow.__HARNESS_SEED__ = ${0x5eed4242};\n${INJECT}` });
    const url = `${base}/index.html?dev=1&trafficSeed=7&scena=holowanie&hol=${hol}${query}`;
    report.url = url.replace(base, 'http://localhost:5173');
    await cdp.send('Page.navigate', { url });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.DevScene)', 240000, 400)) throw new Error('gra nie wstała');
    await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
    await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
    report.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
    if (!await waitFor(cdp, '!!(window.TrafficV2 && window.TrafficV2.ready && window.TrafficV2.tables && window.TrafficV2.tables.bubblePorts && window.TrafficV2.tables.bubblePorts.earth)', 120000, 300)) throw new Error('ruch v2 nie wstał');
    // Scena rusza sekundę po wejściu do gry (`?scena=holowanie`), rozstawia się po rozgrzewce świata ruchu.
    if (!await waitFor(cdp, '!!(window.TowScene && window.TowScene.active)', 30000, 200)) throw new Error('scena nie ruszyła');
    if (!await waitFor(cdp, '!(window.TrafficV2.warmup && window.TrafficV2.warmup.active)', 300000, 500)) throw new Error('rozgrzewka świata nie skończyła się');
    report.syncStart = syncWorker();
    report.syncStronaStart = await syncPage();
    await ev('window.__harness.hold(true)');
    report.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
    console.log(`[${hol}] tryb ${report.tryb}, ${report.url}`);

    const atlasHp = '({ tarcza: Math.round(window.ship.shield?.val ?? -1), zniszczony: !!window.ship.destroyed })';
    report.atlasPrzed = await ev(atlasHp);
    // 1) Rozstawienie, śmierć statków, kolejka wraków.
    for (let i = 0; i < 240; i++) {
      const s = await ev('window.TowScene.phase');
      if (s === 'kolejka' || s === 'praca') break;
      if (s === 'wraki' && !report.zdarzenia.some((e) => e.co === 'wraki')) {
        report.zdarzenia.push({ co: 'wraki', t: gameT });
        await step(30); gameT += 0.5;
        await shot('0a-wybuchy', 'statki sceny giną ścieżką gry (pula HP, stopienie rdzenia pancernika)');
      }
      await step(30); gameT += 0.5;
    }
    report.kolejka = await ev('window.TowScene.log.slice()');
    await step(60); gameT += 1;
    await shot('0b-plac', 'plac wraków, Atlas z boku, lejek ringu Ziemi (punkt zrzutu) po stronie Ziemi');
    const s0 = await state();
    report.plac = { spot: s0?.spot, u: s0?.u, earth: s0?.earth, wraki: s0?.rep };

    // 2) Sekwencja: przylot, lina, hol, zrzut (pierwszy hol), cięcie i po cięciu (pierwsze cięcie). Film kadru sceny
    //    co 1 s gry od przylotu holownika do zniknięcia wraku na lejku (+ 2 s).
    const seen = {};
    const haul = { probki: [], maxV: 0, wrakMaxV: 0, ostatnia: null };
    const filmDir = join(out, 'hol-klatki');
    if (FILM) mkdirSync(filmDir, { recursive: true });
    let frames = 0, lastFrame = -1;
    let towGid = null, cutGid = null;
    for (; gameT < GAME_LIMIT;) {
      await step(30); gameT += 0.5;
      const s = await state();
      if (!s) break;
      if (Math.round(gameT * 2) % 10 === 0) (report.npcLog || (report.npcLog = [])).push({ t: gameT, npc: s.npc });
      // Pierwszy hol i pierwsze cięcie sceny: kolejka sceny (rola i tryb z rekordu zgłoszenia).
      const cur = s.current;
      if (towGid == null && cur?.tow) towGid = cur.gid;
      if (cutGid == null && cur && !cur.tow) cutGid = cur.gid;
      const tow = towGid != null ? s.works.find((w) => w.gid === towGid) : null;
      const cut = cutGid != null ? s.works.find((w) => w.gid === cutGid) : null;
      if (towGid != null && !seen.przylot && !tow) {
        const inb = await inbound(towGid);
        const wr = s.rep.find((r) => r.gid === towGid);
        if (inb?.tug && wr) {
          const d = Math.sqrt((inb.tug.x - wr.x) ** 2 + (inb.tug.y - wr.y) ** 2);
          if (!seen.wDrodze) {
            seen.wDrodze = gameT;
            report.holownik = { kurs: inb.course, kadlub: inb.tug.hull, klasa: inb.unit, odWraku: Math.round(d), postoj: inb.spot, wrak: { x: wr.x, y: wr.y, r: wr.r },
              stacjaWorkera: await ev('(() => { const st = window.TrafficV2.getStation("earth"); return st ? { x: Math.round(st.x), y: Math.round(st.y) } : null; })()') };
            console.log(`  [${hol}] holownik: ${JSON.stringify(report.holownik)}`);
          }
          if (d < 3500) {
            seen.przylot = gameT;
            await shot('1a-przylot', `holownik (${inb.tug.hull}) w drodze do wraku niszczyciela, ${Math.round(d)} j. od wraku, ${inb.tug.v} j./s`);
            await closeUp('1b-przylot-blisko', 'przylot z bliska', { x: (inb.tug.x + wr.x) / 2, y: (inb.tug.y + wr.y) / 2 }, 3200);
          }
        }
      }
      if (tow && tow.rope && !seen.lina) {
        seen.lina = gameT;
        if (!seen.przylot) seen.przylot = gameT;
        await step(60); gameT += 1;
        await shot('2a-lina', 'lina podpięta, zaczepianie (wiązka przy linie)');
        const t2 = (await state()).works.find((w) => w.gid === towGid);
        if (t2?.tug && t2.wrak) await closeUp('2b-lina-blisko', 'lina i wiązka z bliska', { x: (t2.tug.x + t2.wrak.x) / 2, y: (t2.tug.y + t2.wrak.y) / 2 }, 2400);
      }
      if (tow && tow.phase === 'haul') {
        if (!seen.hol) seen.hol = gameT;
        haul.probki.push({ t: gameT, tug: tow.tug?.v ?? null, wrak: tow.wrak?.v ?? null, kat: tow.tug?.kat, kurs: tow.tug?.kurs,
          wrakZa: tow.tug && tow.wrak ? +Math.atan2(tow.wrak.y - tow.tug.y, tow.wrak.x - tow.tug.x).toFixed(2) : null });
        haul.maxV = Math.max(haul.maxV, tow.tug?.v || 0);
        haul.wrakMaxV = Math.max(haul.wrakMaxV, tow.wrak?.v || 0);
        if (tow.tug) haul.ostatnia = { x: tow.tug.x, y: tow.tug.y, t: gameT };
        if (!seen.holZrzut && gameT - seen.hol >= 2.5) {
          seen.holZrzut = gameT;
          await shot('3a-hol', `hol: wrak na linie jedzie za holownikiem do lejka ringu (${tow.tug?.v ?? '?'} j./s)`);
          if (tow.tug && tow.wrak) await closeUp('3b-hol-blisko', 'hol z bliska', { x: (tow.tug.x + tow.wrak.x) / 2, y: (tow.tug.y + tow.wrak.y) / 2 }, 2800);
        }
      }
      if (towGid != null && seen.hol && !seen.zrzut && !s.rep.some((r) => r.gid === towGid)) {
        seen.zrzut = gameT;
        await shot('4-zrzut', 'wrak zniknął z holownikiem na lejku ringu (punkt zrzutu)');
      }
      if (cut && cut.cut > 0 && !seen.ciecie0) seen.ciecie0 = gameT;
      if (cut && seen.ciecie0 && !seen.ciecie && gameT - seen.ciecie0 >= 12) {
        seen.ciecie = gameT;
        await shot('5a-ciecie', 'drugi złomiarz tnie odłam pancernika (palniki, iskry, odłamki)');
        if (cut.wrak) await closeUp('5b-ciecie-blisko', `cięcie z bliska (węzły ${cut.wrak.wezly} z ${cut.cut})`, { x: cut.wrak.x, y: cut.wrak.y }, 1800);
      }
      if (cutGid != null && seen.ciecie && !seen.poCieciu && !s.rep.some((r) => r.gid === cutGid)) {
        seen.poCieciu = gameT;
        await shot('6-po-cieciu', 'odłam pocięty — reszta zniknęła po końcu pracy');
      }
      // Film: klatka co 1 s gry od holownika w drodze do zrzutu (+2 s).
      if (FILM && seen.wDrodze && (!seen.zrzut || gameT - seen.zrzut <= 2) && gameT - lastFrame >= 1) {
        lastFrame = gameT;
        await screenshotPng(cdp, join(filmDir, `${String(frames++).padStart(3, '0')}.png`));
      }
      if (s.faza === 'koniec' || (seen.zrzut && seen.poCieciu && gameT - Math.max(seen.zrzut, seen.poCieciu) > 20)) break;
    }
    if (haul.ostatnia && s0?.earth) {
      haul.ostatnia.odZiemi = Math.round(Math.sqrt((haul.ostatnia.x - s0.earth.x) ** 2 + (haul.ostatnia.y - s0.earth.y) ** 2));
    }
    const haulFilm = FILM && frames > 1 ? gif(out, 'hol', filmDir, 1000) : null;
    report.zdarzenia.push({ co: 'sekwencja', ...seen });
    report.hol = { gid: towGid, maxV: haul.maxV, wrakMaxV: haul.wrakMaxV, probek: haul.probki.length,
      srednia: haul.probki.length ? Math.round(haul.probki.reduce((a, p) => a + (p.tug || 0), 0) / haul.probki.length) : null,
      probki: haul.probki.slice(0, 80), ostatnia: haul.ostatnia };
    report.film = haulFilm ? { ...haulFilm, klatek: frames } : null;
    await shot('7-koniec', 'kadr sceny na końcu przebiegu');
    report.atlasPo = await ev(atlasHp);
    console.log(`[${hol}] Atlas przed / po: ${JSON.stringify(report.atlasPrzed)} / ${JSON.stringify(report.atlasPo)}`);
    report.scena = await ev('({ faza: window.TowScene.phase, t: window.TowScene.t, log: window.TowScene.log.slice() })');
    report.dziennik = await ev('window.TrafficSalvage.log.slice(-80)');
    report.stats = await ev('({ ...window.TrafficSalvage.stats })');
    report.syncKoniec = syncWorker();
    report.syncStronaKoniec = await syncPage();
    report.bledyStrony = logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20);
    report.bledyWorkera = workerLogs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]')).slice(0, 20);
    console.log(`[${hol}] sekwencja`, JSON.stringify(seen));
    console.log(`[${hol}] hol: maks. ${haul.maxV} j./s, średnio ${report.hol.srednia} j./s (${haul.probki.length} próbek)`);
    console.log(`[${hol}] sync worker ${report.syncKoniec.length}, strona ${report.syncStronaKoniec.length}; błędy strony ${report.bledyStrony.length}, workera ${report.bledyWorkera.length}`);
    for (const l of [...report.bledyStrony, ...report.bledyWorkera].slice(0, 8)) console.log('   ', l.slice(0, 300));
  } catch (err) {
    report.blad = String(err?.stack || err);
    console.error(`[${hol}]`, report.blad);
    try { await shot('blad', 'kadr w chwili błędu'); } catch {}
  } finally {
    writeJson(join(out, 'raport.json'), report);
    try { await chrome.close(); } catch {}
  }
  return report;
}

/** Klatki z katalogu → GIF (Pillow, gdy jest). */
function gif(out, name, dir, frameMs) {
  const file = join(out, `${name}.gif`);
  const py = `import sys, glob
from PIL import Image
fs = sorted(glob.glob(sys.argv[1] + '/*.png'))
ims = [Image.open(f).convert('RGB').resize((1280, 360)).convert('P', palette=Image.ADAPTIVE, colors=160) for f in fs]
ims[0].save(sys.argv[2], save_all=True, append_images=ims[1:], duration=${frameMs}, loop=0, optimize=True)
`;
  const pyFile = join(out, '_gif.py');
  writeFileSync(pyFile, py);
  const r = spawnSync('python', [pyFile, dir, file], { encoding: 'utf8' });
  return { gif: r.status === 0 ? file : null, blad: r.status === 0 ? null : (r.stderr || '').slice(0, 400) };
}

const guard = setTimeout(() => { console.error('LIMIT CZASU PRZEBIEGU'); process.exit(2); }, Number(args.limit || 50) * 60000);
try {
  for (const hol of SPEEDS) all.przebiegi[hol] = await runSpeed(hol);
} finally {
  clearTimeout(guard);
  writeJson(join(outRoot, 'raport.json'), all);
  try { await server.close(); } catch {}
}
process.exit(0);
