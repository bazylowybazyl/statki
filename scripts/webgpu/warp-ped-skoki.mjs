// Skoki ciał w soczewce świata (demo „Pęd”, dema/warp-ped.html): klatka po klatce środek, wielkość, β, bramka
// ringu, wejście i widoczność planet i księżyców w skoku — przy kilku zoomach gracza i trybach obrotu kadru.
// Wykrywa SKOKI (szarpnięcie położenia |p[i+1] − 2·p[i] + p[i−1]| albo wielkości ponad próg) i MIGNIĘCIA (ciało
// w kadrze, a grupa schowana). Zgłoszenie usera 2026-10-19: „mijane planety lubią dziwnie skakać, planeta docelowa
// pokazuje się na chwilę, potem jej nie widać i znowu wskakuje — przy przybliżonej kamerze najbardziej”.
//
//   node scripts/webgpu/warp-ped-skoki.mjs [--zoomy 0.06,0.2,0.6,1.2] [--kamera up,off] [--osrodek 0|1]
//     [--trasa jowisz|mars] [--prog 25] [--out .tmp/warp-ped/skoki] [--zrzuty 1] [--zoomSkoku staly,gracz]
//
// Wynik: tabela na konsoli, <out>/raport.json (zdarzenia z kontekstem; `cel` — przebieg celu od wyjścia: czas, β,
// zoom, środek, promień, widoczność, w kadrze), przy --zrzuty 1 zrzut klatki największego skoku.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/warp-ped/skoki');
const zoomy = String(args.zoomy || '0.06,0.2,0.6,1.2').split(',').map(Number);
const kamery = String(args.kamera || 'up,off').split(',');
// Jeden warp (sprzątanie S1, 2026-10-26 — style skoku usunięte); ośrodek drobin tylko A/B (`--osrodek 1`).
const osrodek = String(args.osrodek || '0') === '1';
const zoomySkoku = String(args.zoomSkoku || 'staly').split(',');
const prog = Number(args.prog || 25);
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5434));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const report = { scenariusze: [] };

// Jeden przelot: od restartu do `poT` s po zatrzymaniu; co klatkę stan soczewki i ciał (gdy soczewka działa) oraz
// od wyjścia — cel na ekranie (grupa planety rzutowana kamerą gry: w soczewce i po niej), czy widoczny i w kadrze.
const RECORD = (poT) => `(async () => {
  const d = window.__warpPed, WL = window.__warpWorldLens, L = WL.state;
  d.restart();
  const t0 = d.S.time;
  const rows = [], cel = [];
  for (let i = 0; i < 4000; i++) {
    await d.runFrames(1, 60);
    if ((i & 7) === 7) await new Promise((ok) => requestAnimationFrame(() => ok()));
    const t = +(d.S.time - t0).toFixed(3), ramp = d.warp.exitRamp ? +d.warp.exitRamp.age.toFixed(2) : null;
    if (L.active) rows.push({ i, t, st: d.warp.state, ramp,
      zoom: L.zoom, roll: +L.roll.toFixed(3), beta: +L.beta.toFixed(4), W: L.W, H: L.H, sx: Math.round(L.shipSx), sy: Math.round(L.shipSy),
      b: WL.bodies() });
    const tgt = d.trip.to;
    const ent = tgt && (window._entities || []).find((e) => e.data === tgt);
    if (ent && ent.group && (ramp !== null || d.trip.phase === 'po')) {
      const c = window.camera, gp = ent.group.position, s = ent.group.scale.x, ro = c.roll || 0;
      const dx = gp.x - c.x, dy = -gp.y - c.y, co = Math.cos(ro), si = Math.sin(ro);
      const x = (co * dx + si * dy) * c.zoom, y = (-si * dx + co * dy) * c.zoom, r = s * c.zoom;
      const ex = Math.max(0, Math.abs(x) - innerWidth / 2), ey = Math.max(0, Math.abs(y) - innerHeight / 2);
      // orientacja bryły (kwaternion siatki) i kierunek słońca w układzie sceny — obrót celu przy przejściu
      const q = ent.mesh ? ent.mesh.quaternion : null;
      const sp = ent.uniforms && ent.uniforms.sunPosition ? ent.uniforms.sunPosition.value : null;
      const sx = sp ? sp.x - gp.x : 0, sy = sp ? sp.y - gp.y : 0, sz = sp ? sp.z - gp.z : 0, sl = Math.hypot(sx, sy, sz) || 1;
      cel.push({ t, ramp, faza: d.trip.phase, v: Math.round(Math.hypot(d.atlas.vx, d.atlas.vy)), beta: L.active ? +L.beta.toFixed(3) : 0, zoom: +c.zoom.toFixed(4),
        x: Math.round(x), y: Math.round(y), r: Math.round(r), vis: !!ent.group.visible, wKadrze: ex * ex + ey * ey < r * r,
        q: q ? [q.x, q.y, q.z, q.w] : null, sun: [sx / sl, sy / sl, sz / sl] });
    }
    if (d.trip.phase === 'po' && d.trip.t >= ${poT}) break;
  }
  return { rows, cel };
})()`;

// Cel od wyjścia: ile razy wypada z kadru po tym, jak w nim był (znika i wraca = mignięcie celu).
function analyzeTarget(cel) {
  let wyj = 0, powrot = 0, bylo = false, poza = false, klatekW = 0;
  for (const c of cel) {
    const on = c.vis && c.wKadrze;
    if (on) klatekW++;
    if (on && poza) { powrot++; poza = false; }
    if (on) bylo = true;
    else if (bylo && !poza) { wyj++; poza = true; }
  }
  // Obrót bryły celu i jego słońca: największy kąt między kolejnymi klatkami i suma [°] (doba planety ~0,02°/klatkę).
  let maxRot = 0, sumRot = 0, maxSun = 0, sumSun = 0, rotAt = null;
  for (let i = 1; i < cel.length; i++) {
    const a = cel[i - 1], b = cel[i];
    if (a.q && b.q) {
      const dot = Math.min(1, Math.abs(a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3]));
      const deg = 2 * Math.acos(dot) * 180 / Math.PI;
      sumRot += deg;
      if (deg > maxRot) { maxRot = deg; rotAt = b.t; }
    }
    const sd = Math.min(1, a.sun[0] * b.sun[0] + a.sun[1] * b.sun[1] + a.sun[2] * b.sun[2]);
    const sdeg = Math.acos(sd) * 180 / Math.PI;
    sumSun += sdeg;
    maxSun = Math.max(maxSun, sdeg);
  }
  const probki = cel.filter((_, i) => i % 15 === 0 || i === cel.length - 1).map(({ q, sun, ...rest }) => rest);
  return { klatek: cel.length, wKadrze: klatekW, wypada: wyj, wraca: powrot,
    obrot: { maxNaKlatke: +maxRot.toFixed(3), suma: +sumRot.toFixed(2), przy: rotAt, slonceMax: +maxSun.toFixed(3), slonceSuma: +sumSun.toFixed(2) }, probki };
}

function analyze(rows) {
  const ids = new Set();
  for (const r of rows) for (const b of r.b) ids.add(b.id);
  const ev = [];
  const perBody = {};
  for (const id of ids) {
    const seq = rows.map((r) => ({ r, b: r.b.find((q) => q.id === id) }));
    let jumps = 0, flick = 0, maxJerk = 0, maxSize = 0, shown = 0;
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1], c = seq[i];
      if (!a.b || !c.b) continue;
      const inFrame = (q, r) => Math.abs(q.x) - q.size < r.W * 0.5 && Math.abs(q.y) - q.size < r.H * 0.5 && q.size > 0.4;
      if (c.b.visible) shown++;
      // mignięcie: ciało w kadrze (wg soczewki), a grupa schowana — albo odwrotnie: widoczna poza kadrem nie szkodzi
      if (!c.b.visible && inFrame(c.b, c.r) && a.b.visible) {
        flick++;
        ev.push({ id, typ: 'chowa się w kadrze', t: c.r.t, st: c.r.st, ramp: c.r.ramp, beta: c.r.beta, gate: c.b.gate, entry: c.b.entry, x: c.b.x, y: c.b.y, size: c.b.size, zoom: c.r.zoom });
      }
      if (i + 1 >= seq.length) continue;
      const n = seq[i + 1];
      // tylko kolejne klatki (soczewka bywa wyłączona między zapisami — np. przed skokiem)
      if (c.r.i - a.r.i !== 1 || n.r.i - c.r.i !== 1) continue;
      if (!n.b || !(a.b.visible || c.b.visible || n.b.visible)) continue;
      // tylko gdy ciało (w którejś z trzech klatek) jest w kadrze
      if (!inFrame(a.b, a.r) && !inFrame(c.b, c.r) && !inFrame(n.b, n.r)) continue;
      const jx = n.b.x - 2 * c.b.x + a.b.x, jy = n.b.y - 2 * c.b.y + a.b.y;
      const jerk = Math.sqrt(jx * jx + jy * jy);
      const sr = Math.max(c.b.size, 1e-3) / Math.max(a.b.size, 1e-3);
      const sizeJump = Math.abs(Math.log(sr));
      maxJerk = Math.max(maxJerk, jerk);
      maxSize = Math.max(maxSize, sizeJump);
      if (jerk > prog || sizeJump > 0.25) {
        jumps++;
        ev.push({ id, typ: jerk > prog ? 'skok położenia' : 'skok wielkości', jerk: Math.round(jerk), dSize: +sr.toFixed(2), t: c.r.t, st: c.r.st, ramp: c.r.ramp,
          beta: c.r.beta, betaPrev: a.r.beta, gate: c.b.gate, gatePrev: a.b.gate, entry: c.b.entry, entryPrev: a.b.entry,
          prev: [a.b.x, a.b.y, a.b.size, a.b.visible], cur: [c.b.x, c.b.y, c.b.size, c.b.visible], next: [n.b.x, n.b.y, n.b.size, n.b.visible],
          ship: [c.r.sx, c.r.sy], zoom: +c.r.zoom.toFixed(4), roll: c.r.roll, target: c.b.target });
      }
    }
    perBody[id] = { skoki: jumps, migniecia: flick, maxSzarpniecie: Math.round(maxJerk), maxSkokWielkosci: +maxSize.toFixed(2), klatekWidoczna: shown };
  }
  return { perBody, ev };
}

try {
  await cdp.send('Page.navigate', { url: `${base}/dema/warp-ped.html?test=1${osrodek ? '&warpOsrodek=1' : ''}${args.trasa ? `&trasa=${args.trasa}` : ''}` });
  if (!await waitFor(cdp, '!!(window.__warpPed && (window.__warpPed.ready || window.__warpPed.error))', 300000, 500)) throw new Error('demo nie wstało');
  const err = await ev('window.__warpPed.error || null');
  if (err) throw new Error(`demo: ${err}`);
  await ev('window.__warpPed.runFrames(60, 60)');
  const poT = Number(args.po || 4);
  for (const zs of zoomySkoku) for (const kam of kamery) {
    for (const z of zoomy) {
      await ev(`(() => { const d = window.__warpPed; d.setMedium(${osrodek}); d.setCamRoll(${JSON.stringify(kam)}); d.setWarpZoom(${JSON.stringify(zs)}); d.setZoom(${z}); return true; })()`);
      const { rows, cel } = await ev(RECORD(poT));
      const { perBody, ev: zdarzenia } = analyze(rows);
      const celA = analyzeTarget(cel);
      const sc = { zoomSkoku: zs, kamera: kam, zoomGracza: z, klatek: rows.length, zoomWSkoku: rows.length ? +rows[Math.floor(rows.length / 2)].zoom.toFixed(4) : null, ciala: perBody, cel: celA, zdarzenia };
      report.scenariusze.push(sc);
      const lista = Object.entries(perBody).filter(([, v]) => v.klatekWidoczna > 0 || v.skoki || v.migniecia)
        .map(([id, v]) => `${id}: skoki ${v.skoki}, mign. ${v.migniecia}, max ${v.maxSzarpniecie} px / ×${Math.exp(v.maxSkokWielkosci).toFixed(2)}, widoczna ${v.klatekWidoczna}`);
      console.log(`\n== zoom skoku ${zs}, kamera ${kam}, zoom gracza ${z} (w skoku ~${sc.zoomWSkoku}), klatek ${rows.length}`);
      for (const l of lista) console.log('  ' + l);
      console.log(`  CEL od wyjścia: klatek ${celA.klatek}, w kadrze ${celA.wKadrze}, wypada ${celA.wypada}, wraca ${celA.wraca}; obrót bryły max ${celA.obrot.maxNaKlatke}°/klatkę (przy ${celA.obrot.przy} s), suma ${celA.obrot.suma}°; słońce max ${celA.obrot.slonceMax}°, suma ${celA.obrot.slonceSuma}°`);
      for (const e of zdarzenia.slice(0, 12)) console.log('   ·', JSON.stringify(e));
      if (args.zrzuty && zdarzenia.length) {
        // zrzut klatki największego skoku: przelot od nowa do tej chwili
        const big = zdarzenia.reduce((m, e) => ((e.jerk || 0) > (m.jerk || 0) ? e : m), zdarzenia[0]);
        await ev(`(async () => { const d = window.__warpPed; d.restart(); const t0 = d.S.time; await d.until((q) => q.S.time - t0 >= ${big.t} - 1e-6, 4000); return true; })()`);
        await screenshotPng(cdp, join(out, `skok-${zs}-${kam}-z${z}-${big.id}.png`));
      }
    }
  }
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 30);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.error(e);
} finally {
  report.bledy = report.bledy || logs.errors().slice(0, 30);
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 1));
  if (report.bledy.length) console.log('błędy konsoli:', report.bledy);
  await chrome.close();
  await server.close();
  process.exit(0);
}
