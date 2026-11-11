#!/usr/bin/env node
// Pomiar plików dźwięku z generatora (public/sounds/ai/) — dekodowanie w Chrome (headless, `OfflineAudioContext`),
// bo Node nie dekoduje MP3. Nikt z agentów nie słyszy dźwięku: ten pomiar mówi, czy plik nadaje się do oceny przez
// użytkownika (atak na czas, czy nie jest samym basem, do kiedy w ogóle coś słychać).
//
//   node scripts/dzwieki-pomiar.mjs --tylko warpSkok,przylot      pliki tych id (wszystkie warianty)
//   node scripts/dzwieki-pomiar.mjs --pliki warpSkok_1.mp3        pojedyncze pliki
//   node scripts/dzwieki-pomiar.mjs --tylko klik --json .tmp/dzwieki/pomiar.json
//
// Kolumny: dł. — długość pliku [s]; szczyt [dBFS]; RMS — głośnej części (górne 25% okien 50 ms, jak `zmierzPoziom`
// w src/audio/dzwiekiLogika.js); start — pierwsze okno 10 ms powyżej −30 dB względem szczytu obwiedni [s]; atak —
// pierwsze okno w −6 dB od szczytu obwiedni [s]; max — okno szczytu obwiedni [s]; słych. — ostatnie okno powyżej
// −40 dB względem szczytu obwiedni [s]; bas — udział energii poniżej 150 Hz (dolnoprzepustowy 2× biquad) [%].
// Plik „sam bas” (bas > 70%) albo z atakiem dużo po starcie (dźwięk chwilowy) — do ponownej generacji.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, startChrome, startStaticServer, evaluate, repo, writeJson } from './webgpu/wspolne.mjs';

const args = parseArgs();
const manifest = JSON.parse(readFileSync(join(repo, 'public/sounds/ai/manifest.json'), 'utf8'));
let pliki = [];
if (args.pliki) pliki = String(args.pliki).split(',').map((s) => s.trim()).filter(Boolean);
if (args.tylko) {
  const ids = new Set(String(args.tylko).split(',').map((s) => s.trim()));
  pliki.push(...manifest.pliki.filter((p) => ids.has(p.id)).map((p) => p.plik));
}
if (!pliki.length) {
  console.log('Podaj --tylko <id,id> albo --pliki <plik,plik>.');
  process.exit(1);
}

const srv = await startStaticServer(0, join(repo, 'public'));
const chrome = await startChrome({ width: 400, height: 300, webgpu: false });
try {
  await chrome.cdp.send('Page.navigate', { url: `${srv.base}/sounds/ai/manifest.json` });
  await new Promise((ok) => setTimeout(ok, 800));
  const wynik = await evaluate(chrome.cdp, `(async () => {
    const pliki = ${JSON.stringify(pliki)};
    const db = (g) => g > 0 ? 20 * Math.log10(g) : -999;
    const out = [];
    for (const plik of pliki) {
      try {
        const r = await fetch('/sounds/ai/' + plik);
        if (!r.ok) { out.push({ plik, blad: 'HTTP ' + r.status }); continue; }
        const dane = await r.arrayBuffer();
        const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(dane);
        const sr = buf.sampleRate, n = buf.length, ch = buf.numberOfChannels;
        const kan = []; for (let c = 0; c < ch; c++) kan.push(buf.getChannelData(c));
        // obwiednia: RMS w oknach 10 ms
        const o10 = Math.round(sr * 0.01), nw = Math.ceil(n / o10);
        const env = new Float64Array(nw);
        let szczyt = 0;
        for (let w = 0; w < nw; w++) {
          let s = 0; const a = w * o10, b = Math.min(n, a + o10);
          for (const k of kan) for (let i = a; i < b; i++) { const v = k[i]; s += v * v; const av = v < 0 ? -v : v; if (av > szczyt) szczyt = av; }
          env[w] = Math.sqrt(s / ((b - a) * ch));
        }
        let emax = 0, wmax = 0; for (let w = 0; w < nw; w++) if (env[w] > emax) { emax = env[w]; wmax = w; }
        const prog = (dB) => emax * Math.pow(10, dB / 20);
        let start = -1, atak = -1, slych = -1;
        for (let w = 0; w < nw; w++) { if (start < 0 && env[w] >= prog(-30)) start = w; if (atak < 0 && env[w] >= prog(-6)) atak = w; if (env[w] >= prog(-40)) slych = w; }
        // RMS głośnej części (okna 50 ms, górne 25%)
        const o50 = Math.round(sr * 0.05), n50 = Math.ceil(n / o50), moce = [];
        for (let w = 0; w < n50; w++) { let s = 0; const a = w * o50, b = Math.min(n, a + o50); for (const k of kan) for (let i = a; i < b; i++) s += k[i] * k[i]; moce.push(s / ((b - a) * ch)); }
        moce.sort((x, y) => x - y);
        const kk = Math.max(1, Math.round(n50 * 0.25)); let sm = 0; for (let i = n50 - kk; i < n50; i++) sm += moce[i];
        // energia poniżej 150 Hz (Q dolnoprzepustowego w Web Audio jest w dB: −3,01 dB = Butterworth, bez rezonansu)
        const off = new OfflineAudioContext(ch, n, sr);
        const src = off.createBufferSource(); src.buffer = buf;
        const f1 = off.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.value = 150; f1.Q.value = -3.0103;
        const f2 = off.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 150; f2.Q.value = -3.0103;
        src.connect(f1); f1.connect(f2); f2.connect(off.destination); src.start();
        const lp = await off.startRendering();
        let eAll = 0, eLow = 0;
        for (let c = 0; c < ch; c++) { const a = kan[c], b = lp.getChannelData(c); for (let i = 0; i < n; i++) { eAll += a[i] * a[i]; eLow += b[i] * b[i]; } }
        out.push({ plik, dl: n / sr, szczytDb: db(szczyt), rmsDb: db(Math.sqrt(sm / kk)), start: start * 0.01, atak: atak * 0.01, max: wmax * 0.01, slych: (slych + 1) * 0.01, bas: eAll > 0 ? eLow / eAll : 0 });
      } catch (e) { out.push({ plik, blad: String(e && e.message || e) }); }
    }
    return out;
  })()`, 300000);
  const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
  console.log('plik                       dł.    szczyt  RMS     start  atak   max    słych.  bas');
  for (const w of wynik) {
    if (w.blad) { console.log(`${w.plik.padEnd(26)} BŁĄD: ${w.blad}`); continue; }
    const uwagi = [];
    if (w.bas > 0.7) uwagi.push('SAM BAS');
    if (w.atak - w.start > 0.25) uwagi.push('atak późno');
    console.log([w.plik.padEnd(26), f(w.dl).padStart(5), f(w.szczytDb, 1).padStart(7), f(w.rmsDb, 1).padStart(7),
      f(w.start).padStart(6), f(w.atak).padStart(6), f(w.max).padStart(6), f(w.slych).padStart(7),
      `${Math.round(w.bas * 100)}%`.padStart(5), uwagi.join(', ')].join(' '));
  }
  if (args.json) writeJson(join(repo, args.json), wynik);
} finally {
  await chrome.close();
  await srv.close();
}
