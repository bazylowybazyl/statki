// BAŃKA RUCHU v2 w PRAWDZIWEJ grze (E6, docs/PLAN-ekonomia-rynki.md § 3.5): statki ruchu przy Ziemi (lot liczy
// worker ruchu, proxy rysuje worker renderu), dokowanie w halach K-7 i zatokach, trafienia ogniem gracza i awans
// do pełnego NPC (kadłub na belkach, wrak, powrót do bańki), taran, stanowisko gracza (`berth-hold`), przegląd
// innych portów (`--porty`), błędy konsoli, pipeline'y synchroniczne workera renderu i koszt.
// Vite + headless Chrome z WebGPU (CDP), gra swobodna.
//
//   node scripts/webgpu/ruch-banka-gra.mjs [--query renderWorker=1] [--out .tmp/ruch-banka] [--port 5461]
//        [--rozgrzewka 2400] [--obserwacja 40] [--porty mars,jupiter,luna,ceres,mercury,vesta]
//
// Przebieg: start gry → świat ruchu rozgrzany `--rozgrzewka` s czasu świata (`TrafficV2.advance` — gospodarka
// startuje od zera, a statki do portu Ziemi lecą minuty) → gracz przy porcie Ziemi → obserwacja `--obserwacja` s
// gry (fazy encji, stanowiska K-7 / zatok, zrzuty) → ostrzał statku ruchu (`fireWeaponCore` gracza, pociski
// w pętli kolizji gry) → taran → postój gracza na wolnym stanowisku (`berth-hold`) → koszt (worker ruchu,
// most, worker renderu CPU / GPU z proxy i bez — `TrafficBubble.hideRender`).
// Wynik: <out>/raport.json, zrzuty <out>/*.png, dziennik workerów <out>/worker.log.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/ruch-banka');
mkdirSync(out, { recursive: true });
const query = `&${args.query || 'renderWorker=1'}`;
const WARM = Number(args.rozgrzewka || 2400);
const OBS = Number(args.obserwacja || 40);
const PORTS = String(args.porty ?? 'mars,jupiter,luna,ceres,mercury,vesta').split(',').map((s) => s.trim()).filter((s) => s && s !== '-');
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5461));
const chrome = await startChrome({ width: 1600, height: 900 });
// Strażnik przebiegu: zawieszona strona nie trzyma procesu w nieskończoność (Chrome zamykany przy wyjściu).
const guard = setTimeout(async () => { console.error('LIMIT CZASU PRZEBIEGU'); try { await chrome.close(); } catch {} process.exit(2); },
  Number(args.limit || 25) * 60000);
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { query, etapy: {} };
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

const gameT = () => ev('(window.TrafficV2 && window.TrafficV2.time) || 0');
// Zegar krokowy harnessu (`__harness.hold` + `step`): w trybie worker zegar „real” bez limitu klatek zapycha stronę
// (pamięć renderera, brak odpowiedzi) — gra idzie po 1/60 s na krok, warunki sprawdzane z Node między krokami.
async function waitGame(seconds) {
  let left = Math.max(1, Math.round(seconds * 60));
  while (left > 0) {
    const n = Math.min(120, left);
    await ev(`window.__harness.step(${n}).then(() => true)`, 600000);
    left -= n;
  }
}
// Kamera nad graczem w zadanym zoomie (jak inne narzędzia: manualZoom + zoomBase, minimum gry obniżone).
const ZOOM = (z) => `(() => { const c = window.camera; c.minZoom = 0.003; c.manualZoom = true;
  c.zoom = c.targetZoom = c.zoomBase = ${z}; window.DevScene?.syncCamera?.(); return true; })()`;
// Stan bańki po stronie gry (encje, fazy, stanowiska) — jeden odczyt.
const bubbleState = () => ev(`(() => {
  const tb = window.TrafficBubble, br = window.TrafficV2, s = window.ship;
  const phases = {}, berths = { k7: 0, bay: 0 }, docked = [];
  let stock = 0;
  for (const a of tb.list) {
    if (a.flags & 64) { stock++; continue; }   // zapas floty na padach K-7 (STOCK) — osobno
    phases[a.phase] = (phases[a.phase] || 0) + 1;
    if (a.berthId && (a.phase === 'docked' || a.phase === 'capture')) {
      if (a.berthId.includes(':K7-')) berths.k7++; else berths.bay++;
      docked.push({ id: a.id, berth: a.berthId, x: a.cx, y: a.cy, hull: a.hullId, phase: a.phase });
    }
  }
  const st = br.getStats();
  // Lampki ringu: stanowiska hal i zatok Ziemi oznaczone przez ruch (rejestr kolidera — ten sam, który czyta obraz).
  const reg = window.__haloWorld?.entry('earth')?.collider?.registry;
  let lamps = 0;
  if (reg) for (const e of reg.entries) if (e.berth.occupied === 'traffic' || e.berth.reserved === 'traffic') lamps++;
  return { t: br.time, actors: tb.list.length - stock, stock, phases, berths, lamps, docked: docked.slice(0, 40),
    held: tb.held.slice(), stats: { ...tb.stats }, actorMs: st.actorMs, bridgeCourses: st.courses,
    player: { x: s.pos.x, y: s.pos.y } };
})()`);

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
  } catch {} })();\nwindow.__HARNESS_SEED__ = ${0x5eed4242};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&trafficSeed=7${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.DevScene)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  report.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
  if (!await waitFor(cdp, '!!(window.TrafficV2 && window.TrafficV2.ready && window.TrafficV2.tables && window.TrafficV2.tables.bubblePorts && window.TrafficV2.tables.bubblePorts.earth)', 120000, 300)) throw new Error('ruch v2 nie wstał');
  report.syncStart = syncWorker();
  await ev('window.__harness.hold(true)');
  report.ruch = await ev('({ tryb: window.TrafficV2.mode, stanowiskZiemi: window.TrafficV2.tables.bubblePorts.earth.length })');
  console.log('tryb', report.tryb, JSON.stringify(report.ruch));

  // Rozgrzewka gospodarki (narzędzie): świat startuje od zera, a statki lecą do Ziemi minuty.
  const tw0 = Date.now();
  await ev(`(async () => { for (let i = 0; i < ${Math.ceil(WARM / 5)}; i++) { window.TrafficV2.advance(5); if (i % 40 === 39) await new Promise((r) => setTimeout(r, 0)); } return true; })()`, 600000);
  // Worker ruchu nadrabia zegar w swoim tempie (krok świata ~20–30 ms) — czekamy na tick z tym czasem.
  if (!await waitFor(cdp, `(window.TrafficV2.clock || 0) >= ${WARM - 30}`, 600000, 500)) throw new Error('worker ruchu nie nadrobił rozgrzewki');
  console.log('rozgrzewka świata', WARM, 's w', Date.now() - tw0, 'ms');

  // Gracz przy porcie Ziemi: 7 tys. j. na zewnątrz od pierwszej zatoki (poza płytą ringu).
  const spot = await ev(`(() => {
    const berths = window.TrafficV2.tables.bubblePorts.earth;
    const earth = window.TrafficV2.getStation('earth');
    const b = berths.find((x) => x.hall === 'ZATOKA') || berths[0];
    const dx = b.x - earth.x, dy = b.y - earth.y, d = Math.hypot(dx, dy);
    const x = b.x + dx / d * 7000, y = b.y + dy / d * 7000;
    window.devTeleportTo(x, y, { angle: Math.atan2(-dy, -dx), quiet: true });
    window.ship.vel.x = 0; window.ship.vel.y = 0;
    return { x, y, berth: b.id, earth: { x: earth.x, y: earth.y } };
  })()`);
  report.spot = spot;
  await ev(ZOOM(0.045));
  await waitGame(4);
  await screenshotPng(cdp, join(out, '01-port-ziemi.png'));

  // Obserwacja: fazy encji, stanowiska K-7 / zatok, kursy, które przeszły przez przechwyt — najpierw przy zatoce,
  // potem nad halą K-7 tego samego kompleksu (stanowiska wojskowe: okręty i patrole).
  const seenDocked = new Map();
  const seen = new Set();
  const samples = [];
  const t0 = await gameT();
  let shot = 0;
  let movedToK7 = false;
  for (;;) {
    const s = await bubbleState();
    samples.push({ t: +(s.t - t0).toFixed(1), actors: s.actors, zapasK7: s.stock, phases: s.phases, berths: s.berths, lampki: s.lamps, actorMs: s.actorMs });
    for (const d of s.docked) { seenDocked.set(d.id, d.berth); }
    if (s.actors) for (const id of await ev('window.TrafficBubble.list.map((a) => a.id)')) seen.add(id);
    if (s.t - t0 > OBS * (shot + 1) / 4 && shot < 4) {
      shot++;
      await screenshotPng(cdp, join(out, `02-obserwacja-${shot}.png`));
    }
    if (!movedToK7 && s.t - t0 >= OBS / 2) {
      movedToK7 = true;
      report.spotK7 = await ev(`(() => {
        const berths = window.TrafficV2.tables.bubblePorts.earth;
        const earth = window.TrafficV2.getStation('earth');
        const b = berths.find((x) => x.hall === 'K-7');
        const dx = b.x - earth.x, dy = b.y - earth.y, d = Math.hypot(dx, dy);
        const x = b.x + dx / d * 6000, y = b.y + dy / d * 6000;
        window.devTeleportTo(x, y, { angle: Math.atan2(-dy, -dx), quiet: true });
        window.ship.vel.x = 0; window.ship.vel.y = 0;
        return { x, y, berth: b.id };
      })()`);
      await ev(ZOOM(0.045));
    }
    if (s.t - t0 >= OBS) break;
    await waitGame(2);
  }
  const dockedList = [...seenDocked.values()];
  report.etapy.obserwacja = {
    probki: samples,
    encji: seen.size,
    zadokowanych: seenDocked.size,
    k7: dockedList.filter((b) => b.includes(':K7-')).length,
    zatoki: dockedList.filter((b) => !b.includes(':K7-')).length,
    stanowiska: dockedList.slice(0, 30)
  };
  console.log('obserwacja:', JSON.stringify({ encji: seen.size, zadokowanych: seenDocked.size, k7: report.etapy.obserwacja.k7, zatoki: report.etapy.obserwacja.zatoki }));

  // Hala K-7 z zapasem floty na padach (okręty bez kursów) — zrzut nad halą.
  report.zapasK7 = await ev(`(() => {
    const tb = window.TrafficBubble;
    const st = tb.list.filter((a) => a.flags & 64);
    if (!st.length) return { okretow: 0 };
    const a = st[0];
    window.devTeleportTo(a.cx + 1500, a.cy + 600, { angle: 0, quiet: true });
    window.ship.vel.x = 0; window.ship.vel.y = 0;
    return { okretow: st.length, kadluby: [...new Set(st.map((x) => x.hullId))], pad: a.berthId };
  })()`);
  if (report.zapasK7?.okretow) {
    await ev(ZOOM(0.12));
    await waitGame(2);
    await screenshotPng(cdp, join(out, '02b-hala-k7-zapas.png'));
  }
  console.log('zapas K-7:', JSON.stringify(report.zapasK7));

  // Zbliżenie na statek przy stanowisku (K-7, jeśli jest; inaczej zatoka).
  const close = await ev(`(() => {
    const tb = window.TrafficBubble;
    const at = tb.list.filter((a) => a.berthId && a.phase === 'docked' && !(a.flags & 64));
    const a = at.find((x) => x.berthId.includes(':K7-')) || at[0] || tb.list[0];
    if (!a) return null;
    const off = Math.max(700, a.length * 0.9);
    window.devTeleportTo(a.cx + off, a.cy + off * 0.4, { angle: 0, quiet: true });
    window.ship.vel.x = 0; window.ship.vel.y = 0;
    return { id: a.id, berth: a.berthId, hull: a.hullId, phase: a.phase, x: a.cx, y: a.cy };
  })()`);
  report.zblizenie = close;
  await ev(ZOOM(0.2));
  await waitGame(3);
  await screenshotPng(cdp, join(out, '03-zblizenie-stanowisko.png'));

  // Ostrzał: statek ruchu najbliżej gracza w locie, gracz 1600 j. od niego, salwy fireWeaponCore (pociski gry).
  // Działo, które nie zabija jednym strzałem (superbroń 9999 niszczy encję przed awansem): railgun ~500.
  const weapon = await ev(`(() => {
    const W = window.MASTER_WEAPONS || {};
    if (W.special_valkyrie_railgun) return 'special_valkyrie_railgun';
    const ids = Object.keys(W).filter((k) => W[k].category === 'rail' && !W[k].npcOnly && (W[k].baseDamage || 0) <= 600);
    return ids.sort((a, b) => (W[b].baseDamage || 0) - (W[a].baseDamage || 0))[0] || null;
  })()`);
  report.bron = weapon;
  const target = await ev(`(() => {
    const tb = window.TrafficBubble, s = window.ship;
    // Statek, który przeżyje pierwszy strzał (awans) — obrys > 1000 pkt.
    const list = tb.list.filter((a) => !(a.flags & 64) && a.maxHp > 1000 && a.hullId !== 'megafreighter'
      && (a.phase === 'docked' || a.phase === 'hold' || a.phase === 'station' || Math.hypot(a.vx, a.vy) < 260));
    list.sort((a, b) => Math.hypot(a.cx - s.pos.x, a.cy - s.pos.y) - Math.hypot(b.cx - s.pos.x, b.cy - s.pos.y));
    const a = list[0];
    if (!a) return null;
    // Gracz na zewnątrz portu (od Ziemi), 2500 j. od celu — poza zatoką i jej stanowiskami.
    const earth = window.TrafficV2.getStation('earth');
    const ox = a.cx - earth.x, oy = a.cy - earth.y, od = Math.hypot(ox, oy) || 1;
    window.devTeleportTo(a.cx + ox / od * 2500, a.cy + oy / od * 2500, { angle: Math.atan2(-oy, -ox), quiet: true });
    window.ship.vel.x = a.vx; window.ship.vel.y = a.vy;
    return { id: a.id, hull: a.hullId, hp: a.hp, maxHp: a.maxHp, phase: a.phase, x: a.cx, y: a.cy };
  })()`);
  report.etapy.ostrzal = { cel: target };
  // Cel ostrzału: encja bańki albo — po awansie — NPC gry z tym kursem (`trafficCourse`).
  const FIRE_AT = (id, w) => `(() => {
    const a = window.TrafficBubble.byId.get(${id});
    const npc = (a && a.alive) ? null : (window.TrafficPromotion?.alive.get(${id}) || null);
    if (!(a && a.alive) && !(npc && !npc.dead)) return null;
    const x = npc ? npc.x : a.cx, y = npc ? npc.y : a.cy;
    const s = window.ship;
    const dx = x - s.pos.x, dy = y - s.pos.y, d = Math.hypot(dx, dy) || 1;
    // Kierunek pocisku gracza = kierunek lufy (fireWeaponCore: kursor / zamek kręci wieżą, nie pociskiem).
    window.fireWeaponCore(s, null, ${JSON.stringify(w)},
      { pos: { x: s.pos.x, y: s.pos.y }, dir: { x: dx / d, y: dy / d }, baseVel: { x: s.vel.x, y: s.vel.y } });
    return npc ? 'npc' : 'encja';
  })()`;
  const NPC_INFO = (id) => `(() => { const n = window.TrafficPromotion?.alive.get(${id});
    return n ? { id: n.id, kadlub: n.shipFrame, belki: !!n.beamHull, hp: Math.round(n.hp), maxHp: n.maxHp, frakcja: n.factionId,
      rozkaz: n.command?.type || null, x: Math.round(n.x), y: Math.round(n.y), v: Math.round(Math.hypot(n.vx, n.vy)) } : null; })()`;
  if (target && weapon) {
    await ev(ZOOM(0.25));
    await waitGame(1);
    const before = await ev('({ ...window.TrafficBubble.stats, awans: { ...window.TrafficPromotion.stats } })');
    let npcInfo = null;
    let shotNpc = false;
    const kinds = [];
    for (let k = 0; k < 80; k++) {
      const kind = await ev(FIRE_AT(target.id, weapon));
      if (!kind) break;
      kinds.push(kind);
      if (k === 2) await screenshotPng(cdp, join(out, '04-ostrzal.png'));
      if (kind === 'npc' && !npcInfo) npcInfo = await ev(NPC_INFO(target.id));
      if (kind === 'npc' && !shotNpc && (await ev(NPC_INFO(target.id)))?.belki) {
        shotNpc = true;
        await screenshotPng(cdp, join(out, '04b-awans-npc-na-belkach.png'));
        npcInfo = { ...npcInfo, poBudowie: await ev(NPC_INFO(target.id)) };
      }
      await waitGame(0.25);
    }
    await waitGame(2);
    const after = await ev(`(() => { const a = window.TrafficBubble.byId.get(${target.id});
      return { stats: { ...window.TrafficBubble.stats }, awans: { ...window.TrafficPromotion.stats }, hp: a ? a.hp : 0, zyje: !!(a && a.alive),
        npcZyje: window.TrafficPromotion.alive.has(${target.id}) }; })()`);
    await waitGame(6);
    // Wrak z workera (tick świata): `recentWrecks` trzyma ostatnie 64 — szukamy po numerze kursu.
    const wrak = await ev(`window.TrafficV2.recentWrecks.find((w) => w.course === ${target.id}) || null`);
    // Wrak gry (kadłub na belkach NPC → wrak): encja wraku w pobliżu miejsca NPC.
    const wrakGry = npcInfo ? await ev(`(() => { const p = ${JSON.stringify(npcInfo.poBudowie || npcInfo)};
      const w = (window.wrecks || []).filter((n) => Math.hypot(n.x - p.x, n.y - p.y) < 6000);
      return w.length ? { wrakow: w.length, belki: w.some((n) => !!n.beamHull), kadlub: w[0].shipFrame || w[0].type || null } : null; })()`) : null;
    report.etapy.ostrzal = { cel: target, przed: before, po: after, strzaly: kinds.length, wEncje: kinds.filter((k) => k === 'encja').length,
      wNpc: kinds.filter((k) => k === 'npc').length, npc: npcInfo, wrak, wrakGry };
    await screenshotPng(cdp, join(out, '05-po-ostrzale.png'));
    console.log('ostrzał:', JSON.stringify({ trafienEncji: after.stats.hits - before.hits, awans: after.awans, npc: npcInfo, wrak, wrakGry }));
  }

  // Taran: najbliższy statek w locie — gracz rusza na niego z 700 j/s.
  const ram = await ev(`(() => {
    const tb = window.TrafficBubble, s = window.ship;
    const earth = window.TrafficV2.getStation('earth');
    // Statek w locie z dala od ringu i doków (> 62 tys. j. od Ziemi), najwolniejszy.
    const list = tb.list.filter((a) => a.alive && !(a.flags & 64) && a.phase === 'fly' && Math.hypot(a.cx - earth.x, a.cy - earth.y) > 62000);
    list.sort((a, b) => Math.hypot(a.vx, a.vy) - Math.hypot(b.vx, b.vy));
    const a = list[0];
    if (!a) return null;
    // Gracz przed dziobem, burtą do niego, zbliżanie 600 j/s względnie.
    // Burta gracza 5 j. przed dziobem (kontakt w pierwszych krokach, zbliżanie 600 j/s względnie).
    const d = a.length * 0.5 + (Number(s.h) || 0) * 0.5 + 5;
    const fx = Math.cos(a.ca), fy = Math.sin(a.ca);
    window.devTeleportTo(a.cx + fx * d, a.cy + fy * d, { angle: a.ca + Math.PI / 2, quiet: true });
    s.vel.x = a.vx - fx * 600; s.vel.y = a.vy - fy * 600;
    return { id: a.id, hull: a.hullId, hp: a.hp, length: a.length, v: Math.hypot(a.vx, a.vy) };
  })()`);
  if (ram) {
    const r0 = await ev('({ ...window.TrafficBubble.stats })');
    await waitGame(0.1);
    await screenshotPng(cdp, join(out, '05b-taran.png'));
    await waitGame(1);
    const r1 = await ev(`(() => { const a = window.TrafficBubble.byId.get(${ram.id}); return { stats: { ...window.TrafficBubble.stats }, hp: a ? a.hp : 0, zyje: !!(a && a.alive) }; })()`);
    const rNpc = await ev(NPC_INFO(ram.id));
    report.etapy.taran = { cel: ram, przed: r0, po: r1, npc: rNpc };
    console.log('taran:', JSON.stringify({ zderzen: r1.stats.rams - r0.rams, hp: `${ram.hp} → ${r1.hp}`, zyje: r1.zyje, awans: !!rNpc }));
  }

  // Awans i powrót do bańki: statek w locie dostaje jeden słaby pocisk → NPC ucieka; gracz odlatuje 30 tys. j.,
  // koniec walki skrócony do 4 s (narzędzie) → `detach` z pozą, encja wraca do bańki w miejscu NPC.
  const weak = await ev(`(() => { const W = window.MASTER_WEAPONS || {};
    return W.lance_rail_l ? 'lance_rail_l' : Object.keys(W).find((k) => W[k].category === 'rail' && !W[k].npcOnly) || null; })()`);
  const flee = await ev(`(() => {
    const tb = window.TrafficBubble, s = window.ship;
    const list = tb.list.filter((a) => a.alive && a.id >= 0 && !(a.flags & 65) && a.phase === 'fly' && Math.hypot(a.vx, a.vy) < 2000
      && a.hullId !== 'megafreighter' && a.maxHp > 300);
    list.sort((a, b) => Math.hypot(a.cx - s.pos.x, a.cy - s.pos.y) - Math.hypot(b.cx - s.pos.x, b.cy - s.pos.y));
    const a = list[0];
    if (!a) return null;
    const ox = Math.cos(a.ca + Math.PI / 2), oy = Math.sin(a.ca + Math.PI / 2);
    window.devTeleportTo(a.cx + ox * 2000, a.cy + oy * 2000, { angle: a.ca - Math.PI / 2, quiet: true });
    s.vel.x = a.vx; s.vel.y = a.vy;
    window.TrafficPromotion.tune.calmSeconds = 4;
    return { id: a.id, hull: a.hullId, hp: a.hp, maxHp: a.maxHp };
  })()`);
  if (flee && weak) {
    const d0 = await ev('({ ...window.TrafficPromotion.stats, trafien: window.TrafficBubble.stats.hits })');
    for (let k = 0; k < 6; k++) {
      const kind = await ev(FIRE_AT(flee.id, weak));
      if (kind !== 'encja') break;
      await waitGame(0.25);
    }
    await waitGame(1);
    const npc = await ev(NPC_INFO(flee.id));
    await waitGame(2);
    const npc2 = await ev(NPC_INFO(flee.id));
    await ev(ZOOM(0.12));
    await screenshotPng(cdp, join(out, '05c-npc-ucieka.png'));
    // Gracz odlatuje (30 tys. j. od NPC), czekamy na koniec walki i powrót.
    if (npc2) {
      await ev(`(() => { const n = window.TrafficPromotion.alive.get(${flee.id}); const s = window.ship;
        const dx = s.pos.x - n.x, dy = s.pos.y - n.y, d = Math.hypot(dx, dy) || 1;
        window.devTeleportTo(n.x + dx / d * 30000, n.y + dy / d * 30000, { angle: 0, quiet: true });
        s.vel.x = 0; s.vel.y = 0; return true; })()`);
    }
    let back = null;
    let last = npc2;
    for (let i = 0; i < 20 && !back; i++) {
      await waitGame(0.5);
      const cur = await ev(NPC_INFO(flee.id));
      if (cur) last = cur;
      back = await ev(`(() => { const a = window.TrafficBubble.byId.get(${flee.id});
        return a && a.alive ? { x: Math.round(a.cx), y: Math.round(a.cy), faza: a.phase } : null; })()`);
    }
    const d1 = await ev('({ ...window.TrafficPromotion.stats, trafien: window.TrafficBubble.stats.hits })');
    report.etapy.powrot = { cel: flee, bron: weak, npc, npcPo2s: npc2, ostatniaPoza: last, wrocil: back,
      skok: back && last ? Math.round(Math.hypot(back.x - last.x, back.y - last.y)) : null, przed: d0, po: d1 };
    await ev('(() => { window.TrafficPromotion.tune.calmSeconds = 20; return true; })()');
    console.log('awans i powrót:', JSON.stringify({ npc: npc && { rozkaz: npc.rozkaz, belki: npc.belki }, npcPo2s: npc2 && { v: npc2.v, belki: npc2.belki },
      wrocil: back, skok: report.etapy.powrot.skok, staty: d1 }));
  }

  // Stanowisko gracza: gracz staje na wolnym stanowisku zatoki → `berth-hold` → worker nie przydziela go innym.
  // Najpierw nad zatoką (2 s gry — statki przy jej stanowiskach materializują się w bańce), potem wybór wolnego.
  await ev(`(() => { const b = window.TrafficV2.tables.bubblePorts.earth.find((x) => x.hall === 'ZATOKA' && x.maxLength >= 1000);
    const earth = window.TrafficV2.getStation('earth'); const dx = b.x - earth.x, dy = b.y - earth.y, d = Math.hypot(dx, dy);
    window.devTeleportTo(b.x + dx / d * 4000, b.y + dy / d * 4000, { angle: 0, quiet: true });
    window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
  await waitGame(2);
  const hold = await ev(`(() => {
    const tb = window.TrafficBubble;
    const busy = new Set(tb.list.filter((a) => a.berthId).map((a) => a.berthId));
    const b = window.TrafficV2.tables.bubblePorts.earth.find((x) => x.hall === 'ZATOKA' && !busy.has(x.id) && x.maxLength >= 1000);
    if (!b) return null;
    window.devTeleportTo(b.x, b.y, { angle: b.angle, quiet: true });
    window.ship.vel.x = 0; window.ship.vel.y = 0;
    return { berth: b.id };
  })()`);
  if (hold) {
    await waitGame(8);
    const st = await bubbleState();
    const taken = await ev(`window.TrafficBubble.list.filter((a) => a.berthId === ${JSON.stringify(hold.berth)}).map((a) => a.phase)`);
    // Gdzie gracz stoi względem pola stanowiska (wzdłuż / w poprzek osi) i co jest obok.
    const where = await ev(`(() => { const b = window.TrafficV2.tables.bubblePorts.earth.find((x) => x.id === ${JSON.stringify(hold.berth)});
      const s = window.ship; const dx = s.pos.x - b.x, dy = s.pos.y - b.y, c = Math.cos(b.angle), n = Math.sin(b.angle);
      const near = window.TrafficBubble.list.filter((a) => Math.hypot(a.cx - b.x, a.cy - b.y) < 3000).map((a) => ({ id: a.id, faza: a.phase, stan: a.berthId }));
      return { wzdluz: Math.round(dx * c + dy * n), wPoprzek: Math.round(-dx * n + dy * c), pole: [Math.round(b.length), Math.round(b.width)],
        v: Math.round(Math.hypot(s.vel.x, s.vel.y)), obok: near.slice(0, 6) }; })()`);
    report.etapy.postoj = { ...hold, held: st.held, ruchNaStanowisku: taken, gracz: where };
    console.log('postój gracza:', JSON.stringify(report.etapy.postoj));
  }

  // Koszt: gracz nad portem Ziemi, kadr ~25 tys. j.; 8 s z proxy i 8 s bez (A/B obrazu w tym samym miejscu).
  await ev(`(() => { const p = ${JSON.stringify(spot)}; window.devTeleportTo(p.x, p.y, { angle: 0, quiet: true });
    window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
  await ev(ZOOM(0.045));
  await waitGame(3);
  const costRun = async (hide) => {
    await ev(`(() => { window.TrafficBubble.hideRender = ${hide}; return true; })()`);
    await waitGame(2);
    const rows = [];
    for (let i = 0; i < 16; i++) {
      await waitGame(0.25);
      rows.push(await ev(`(() => { const h = window.RenderWorkerHost; if (h && h.readStats) h.readStats(); const st = h ? h.stats : null; const tv = window.TrafficV2.getStats();
        return { gpu: st ? st[0] : (window.Core3D.gpuFrameMs || 0), cpu: st ? st[6] : 0, actorMs: tv.actorMs, actors: tv.actors, gameMs: window.TrafficBubble.stats.gameMs,
          drawn: window.TrafficBubble.list.length, frame: window.PerfHUD?.data?.frameMs ?? null }; })()`));
    }
    const avg = (k) => +(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) / rows.length).toFixed(3);
    return { gpuMs: avg('gpu'), cpuWorkerMs: avg('cpu'), actorMsWorkerRuchu: avg('actorMs'), gameMsWatekGry: avg('gameMs'), encji: avg('actors') };
  };
  const z = await costRun(false);
  const bez = await costRun(true);
  await ev('(() => { window.TrafficBubble.hideRender = false; return true; })()');
  report.koszt = { zProxy: z, bezProxy: bez };
  console.log('koszt z proxy', JSON.stringify(z), '| bez', JSON.stringify(bez));
  await screenshotPng(cdp, join(out, '06-koszt-kadr.png'));

  // Inne porty: gracz 5 tys. j. na zewnątrz od pierwszego stanowiska portu (od środka stacji), 8 s gry, encje,
  // stanowiska, zrzut w kadrze portu i koszt (2 s próbek).
  report.porty = {};
  let pi = 0;
  for (const id of PORTS) {
    pi++;
    const at = await ev(`(() => {
      const berths = window.TrafficV2.tables.bubblePorts?.[${JSON.stringify(id)}];
      const st = window.TrafficV2.getStation(${JSON.stringify(id)});
      if (!berths?.length || !st) return null;
      const b = berths.find((x) => x.hall === 'K-7') || berths[0];
      const dx = b.x - st.x, dy = b.y - st.y, d = Math.hypot(dx, dy) || 1;
      const x = b.x + dx / d * 5000, y = b.y + dy / d * 5000;
      window.devTeleportTo(x, y, { angle: Math.atan2(-dy, -dx), quiet: true });
      window.ship.vel.x = 0; window.ship.vel.y = 0;
      return { x: Math.round(x), y: Math.round(y), stanowisk: berths.length, hale: [...new Set(berths.map((x) => x.hall || 'pomost'))] };
    })()`);
    if (!at) { report.porty[id] = { brak: true }; continue; }
    await ev(ZOOM(0.045));
    await waitGame(8);
    const s = await bubbleState();
    // Koszt w kadrze portu: 2 s z proxy i 2 s bez (A/B `hideRender` w tym samym miejscu).
    const sample = async (hide) => {
      await ev(`(() => { window.TrafficBubble.hideRender = ${hide}; return true; })()`);
      await waitGame(0.5);
      const rows = [];
      for (let i = 0; i < 8; i++) {
        await waitGame(0.25);
        rows.push(await ev(`(() => { const h = window.RenderWorkerHost; if (h && h.readStats) h.readStats(); const st = h ? h.stats : null;
          return { gpu: st ? st[0] : (window.Core3D.gpuFrameMs || 0), cpu: st ? st[6] : 0, actorMs: window.TrafficV2.getStats().actorMs }; })()`));
      }
      return (k) => +(rows.reduce((q, r) => q + (Number(r[k]) || 0), 0) / rows.length).toFixed(3);
    };
    const bezProxy = await sample(true);
    const avg = await sample(false);
    await screenshotPng(cdp, join(out, `07-port-${pi}-${id}.png`));
    // Zbliżenie na statek przy stanowisku tego portu, jeśli jest.
    const dock = s.docked.find((d) => d.berth && d.berth.startsWith(`${id}:`));
    if (dock) {
      await ev(`(() => { window.devTeleportTo(${dock.x} + 900, ${dock.y} + 400, { angle: 0, quiet: true });
        window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
      await ev(ZOOM(0.18));
      await waitGame(2);
      await screenshotPng(cdp, join(out, `07-port-${pi}-${id}-zblizenie.png`));
    }
    report.porty[id] = { ...at, encji: s.actors, zapas: s.stock, fazy: s.phases, zadokowane: s.docked.filter((d) => d.berth?.startsWith(`${id}:`)).length,
      gpuMs: avg('gpu'), cpuWorkerMs: avg('cpu'), actorMs: avg('actorMs'), bezProxy: { gpuMs: bezProxy('gpu'), cpuWorkerMs: bezProxy('cpu') } };
    console.log('port', id, JSON.stringify(report.porty[id]));
  }

  report.syncKoniec = syncWorker();
} catch (e) {
  report.blad = String(e?.stack || e);
  console.error(report.blad);
} finally {
  report.bledyStrony = logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20);
  report.bledyWorkera = workerLogs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]')).slice(0, 20);
  report.ostrzezeniaRuchu = workerLogs.filter((l) => /ruch|Traffic|ShipProxy/i.test(l)).slice(0, 20);
  console.log('pipeline sync workera: start', report.syncStart?.length ?? '-', '| koniec', report.syncKoniec?.length ?? '-',
    (report.syncKoniec || []).slice(0, 6).join(' | '));
  console.log('błędy strony', report.bledyStrony.length, '| workera', report.bledyWorkera.length);
  for (const l of [...report.bledyStrony, ...report.bledyWorkera].slice(0, 8)) console.log('  ', l.slice(0, 300));
  writeFileSync(join(out, 'worker.log'), workerLogs.join('\n'));
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
clearTimeout(guard);
process.exit(0);
