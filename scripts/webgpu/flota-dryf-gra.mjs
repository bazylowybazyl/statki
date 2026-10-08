// Dwie floty naprzeciw siebie w prawdziwej grze (2026-10-08, zgłoszenie „wszyscy lecą w lewo zamiast na siebie”):
// Terra Nova i piraci z trybu LINIE spawnera (spawnCallInShip + WarpNurt.arriveAll — kurs gracza, przylot tunelem)
// albo postawieni wprost twarzą do siebie (--linie 0); co --co ms tory obu stron (środek, prędkość), fazy dowódcy
// floty (getFleetPhase: faza, liczba zagrożeń, front, oś), rodzaje slotów, cele. Na końcu: czas do zwarcia i DRYF
// środka obu flot w bok od osi TN → piraci (dawny błąd: obie floty goniły się bokiem 8 km, zanim się spotkały).
//   node scripts/webgpu/flota-dryf-gra.mjs [--tn 20000,-12000] [--pir 20000,18000] [--order engage|guard]
//        [--sklad 15,6,4] [--linie 1] [--trwanie 60] [--co 2000] [--seed 7] [--port 5294] [--out plik.json]
// --tn / --pir: środki linii flot w układzie gracza (wzdłuż dzioba, w bok), linie prostopadłe do osi między nimi;
// --sklad: fregaty, niszczyciele, pancerniki na stronę (fregaty z przodu, pancerniki 3,6 km za nimi).
// Domyślnie oś flot jest w poprzek kursu gracza — przylot tunelem idzie w bok osi (najgorszy przypadek).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startVite, navigateAndWait, evaluate, sleep } from '../../dema/rdzen-cdp.js';
import { startChrome } from './wspolne.mjs';

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const pair = (s) => String(s).split(',').map(Number);
const TN = pair(arg('tn', '20000,-12000'));
const PIR = pair(arg('pir', '20000,18000'));
const [NF, ND, NB] = pair(arg('sklad', '15,6,4'));
const ORDER = arg('order', 'engage') === 'guard' ? 'guard' : 'engage';
const LINIE = arg('linie', '1') === '1';
const TRWANIE = Number(arg('trwanie', 60));
const CO = Number(arg('co', 2000));
const SEED = Number(arg('seed', 7));
const PORT = Number(arg('port', 5294));
const OUT = arg('out', join(tmpdir(), 'flota-dryf-gra.json'));

const { server, base } = await startVite(PORT);
const chrome = await startChrome({ width: 1280, height: 720 });
const { cdp, logs } = chrome;
// Gra swobodna bez samouczka (kampania stawia gracza w doku), Math.random z ziarnem.
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {}
  let s = ${SEED >>> 0};
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
})();` });
const ev = (e) => evaluate(cdp, e);
const out = { cfg: { TN, PIR, NF, ND, NB, ORDER, LINIE, SEED }, samples: [] };
try {
  await navigateAndWait(cdp, `${base}/index.html?dev=1`,
    '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 180000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  for (let t0 = Date.now(); Date.now() - t0 < 240000;) {
    await sleep(250);
    try { if (await ev('(window.__frameId || 0) > 30 && !!window.camera')) break; } catch { /* ładuje się */ }
  }
  // Pusta przestrzeń między Wenus a Ziemią (jak profil-bitwy-flot.mjs), gracz nieśmiertelny.
  out.place = await ev(`(() => {
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
    return { x: Math.round(best.x), y: Math.round(best.y) };
  })()`);
  await sleep(2000);
  out.spawn = await ev(`(() => {
    const s = window.ship, a = s.angle || 0, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    const res = { piraci: 0, tn: 0 };
    const TN = ${JSON.stringify(TN)}, PIR = ${JSON.stringify(PIR)};
    const ax = PIR[0] - TN[0], ay = PIR[1] - TN[1], al = Math.hypot(ax, ay) || 1, ux = ax / al, uy = ay / al;
    const put = (key, mode, f, sd, toward) => {
      const pos = at(f, sd);
      let r;
      // LINIE: jak finishLineSpawnDrag w index.html (kurs gracza, przylot tunelem).
      if (${LINIE}) { r = window.spawnCallInShip(key, { spawnPos: pos, pos, mode, singleModule: true }); window.WarpNurt?.arriveAll?.(r); }
      else r = window.spawnCallInShip(key, { mode, spawnPos: pos, pos, spawnAngle: a + Math.atan2(toward[1], toward[0]) });
      const k = Array.isArray(r) ? r.length : (r ? 1 : 0); if (mode === 'pirate') res.piraci += k; else res.tn += k; };
    const row = (key, mode, k, ctr, dir, back, spacing) => {
      for (let i = 0; i < k; i++) { const lat = (i - (k - 1) / 2) * spacing;
        put(key, mode, ctr[0] - dir * ux * back - uy * lat, ctr[1] - dir * uy * back + ux * lat, [dir * ux, dir * uy]); } };
    row('frigate_pd', 'pirate', ${NF}, PIR, -1, 0, 650);
    row('destroyer', 'pirate', ${ND}, PIR, -1, 1600, 900);
    row('pirate_battleship', 'pirate', ${NB}, PIR, -1, 3600, 1500);
    row('frigate_laser', 'friendly', ${NF}, TN, 1, 0, 650);
    row('destroyer', 'friendly', ${ND}, TN, 1, 1600, 900);
    row('battleship', 'friendly', ${NB}, TN, 1, 3600, 1500);
    window.__fdRef = { x: s.pos.x, y: s.pos.y, a };
    // Rozkaz PO spawnie piratów — ATAK bez żywych piratów sam wraca do ESKORTY (updateSupportWing).
    window.CockpitSupport.setOrder('${ORDER}');
    return res;
  })()`);
  console.log('spawn', out.spawn, 'rozkaz', ORDER, LINIE ? 'LINIE' : 'wprost');
  // Układ gracza z chwili spawnu: f — wzdłuż dzioba, s — w bok.
  const SAMPLE = `(() => {
    const ref = window.__fdRef, c = Math.cos(ref.a), n = Math.sin(ref.a);
    const loc = (x, y) => { const dx = x - ref.x, dy = y - ref.y; return [Math.round(dx * c + dy * n), Math.round(-dx * n + dy * c)]; };
    const locV = (vx, vy) => [Math.round(vx * c + vy * n), Math.round(-vx * n + vy * c)];
    const npcs = (window.npcs || []).filter((e) => !e.dead && !e.fighter);
    const side = (pred) => {
      const L = npcs.filter(pred); if (!L.length) return null;
      let x = 0, y = 0, vx = 0, vy = 0; const kinds = {}, tgt = { brak: 0, gracz: 0, wrog: 0 };
      for (const e of L) {
        x += e.x; y += e.y; vx += e.vx || 0; vy += e.vy || 0;
        const sl = window.getBattleSlot ? window.getBattleSlot(e) : null;
        const k = sl ? sl.kind + '/' + sl.role : 'brak'; kinds[k] = (kinds[k] || 0) + 1;
        const t = e.forceTarget || e.target; tgt[!t ? 'brak' : (t === window.ship ? 'gracz' : 'wrog')]++;
      }
      const k = L.length;
      return { n: k, c: loc(x / k, y / k), v: locV(vx / k, vy / k), kinds, tgt };
    };
    const deg = (a) => Number.isFinite(a) ? +(((a - ref.a) * 180 / Math.PI + 540) % 360 - 180).toFixed(1) : null;
    const ph = (s) => { const p = window.getFleetPhase?.(s); return p ? { faza: p.phase, zagr: p.threats, front: Math.round(p.frontDist) || null, os: deg(p.axisAng) } : null; };
    return { tn: side((e) => e.friendly === true), pir: side((e) => e.isPirate === true), phTn: ph('friendly'), phPir: ph('pirate'), rozkaz: window.SupportWing?.order };
  })()`;
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < TRWANIE) {
    await sleep(CO);
    const s = await ev(SAMPLE);
    s.t = +((Date.now() - t0) / 1000).toFixed(1);
    out.samples.push(s);
    const f = (o) => o ? `n${o.n} c[${o.c}] v[${o.v}] ${JSON.stringify(o.kinds)} cele${JSON.stringify(o.tgt)}` : '-';
    const p = (o) => o ? `${o.faza} zagr ${o.zagr} front ${o.front} oś ${o.os}°` : '-';
    console.log(`t=${s.t} ${s.rozkaz}\n  TN  ${f(s.tn)} | ${p(s.phTn)}\n  PIR ${f(s.pir)} | ${p(s.phPir)}`);
  }
  // Podsumowanie: oś = pierwsze środki TN → piraci; dryf = przesunięcie środka obu flot w poprzek tej osi.
  const first = out.samples.find((s) => s.tn && s.pir);
  if (first) {
    const ax = first.pir.c[0] - first.tn.c[0], ay = first.pir.c[1] - first.tn.c[1], al = Math.hypot(ax, ay) || 1;
    const lat = (s) => ((s.tn.c[0] + s.pir.c[0]) / 2 * -ay + (s.tn.c[1] + s.pir.c[1]) / 2 * ax) / al;
    const lat0 = lat(first);
    let meet = null;
    let maxDrift = 0;
    for (const s of out.samples) {
      if (!s.tn || !s.pir) break;
      const d = Math.hypot(s.pir.c[0] - s.tn.c[0], s.pir.c[1] - s.tn.c[1]);
      const drift = lat(s) - lat0;
      if (Math.abs(drift) > Math.abs(maxDrift)) maxDrift = drift;
      if (!meet && (d < 6000 || s.phTn?.faza === 'engage' || s.phPir?.faza === 'engage')) meet = { t: s.t, drift, d };
    }
    out.summary = { zwarcie_s: meet ? meet.t : null, dryfDoZwarcia_km: meet ? +(meet.drift / 1000).toFixed(1) : null,
      dryfMax_km: +(maxDrift / 1000).toFixed(1), odstep0_km: +(al / 1000).toFixed(1) };
    console.log('\n== podsumowanie', out.summary);
  }
} finally {
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('próbki:', OUT);
  const errs = logs.filter((l) => /^\[(error|exception)\]/.test(l) && !/AudioSys/.test(l));
  if (errs.length) console.log('błędy:', errs.slice(0, 10));
  await chrome.close();
  await server.close();
}
