#!/usr/bin/env node
// (Wariant z filtrem `--grupa` i flagami ATAK / BAS / CICHY — pomiar grupy „Uzbrojenie”; ogólne narzędzie: scripts/dzwieki-pomiar.mjs.)
// Pomiar plików dźwięków z generatora (public/sounds/ai/, manifest.json) — dekodowanie w przeglądarce
// (headless Chrome, `decodeAudioData` + `OfflineAudioContext`), bez słuchania. Na plik:
//   s        — długość [s]
//   szczyt   — szczyt [dBFS]
//   rms      — RMS głośnej części (górne 25% okien 50 ms — jak `zmierzPoziom` warstwy gry) [dBFS]
//   pocz     — pierwsza próbka powyżej szczyt − 40 dB [ms] (cisza kodera MP3 na początku to ~25–50 ms)
//   atak     — kiedy okno 5 ms dochodzi do (najgłośniejsze okno − 6 dB) [ms od początku pliku]; wystrzał ≤ ~60 ms
//   koniec   — koniec ostatniego okna 10 ms powyżej (najgłośniejsze okno − 40 dB) [s] — do kiedy słychać
//   bas      — udział energii poniżej 150 Hz [%] (filtr dolnoprzepustowy 2 × 2. rzędu)
// Flagi: ATAK (atak > --atakMax, domyślnie 60 ms — tylko dla wpisów bez pętli i bez „ładowania”), BAS (> --basMax %, 85).
//
//   node scripts/dzwieki-pomiar-bronie.mjs --grupa Uzbrojenie [--tylko id,id] [--out .tmp/dzwieki/pomiar.json]
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs, startChrome, startStaticServer, evaluate, repo, writeJson } from './webgpu/wspolne.mjs';

const args = parseArgs();
const atakMax = Number(args.atakMax || 60);
const basMax = Number(args.basMax || 85); // odniesienie: Tempest Ion (oceniony dobrze) 79–88 %, działko piratów 43–98 %
const manifest = JSON.parse(readFileSync(resolve(repo, 'public/sounds/ai/manifest.json'), 'utf8'));
const tylko = args.tylko ? new Set(String(args.tylko).split(',').map((s) => s.trim())) : null;
const grupa = args.grupa ? String(args.grupa).toLowerCase() : null;
const pliki = manifest.pliki.filter((p) => (!tylko || tylko.has(p.id)) && (!grupa || String(p.grupa).toLowerCase() === grupa));
if (!pliki.length) { console.log('Brak plików dla filtra.'); process.exit(1); }

const srv = await startStaticServer(0);
const chrome = await startChrome({ width: 400, height: 300, webgpu: false });
const out = resolve(repo, args.out || '.tmp/dzwieki/pomiar.json');
try {
  await chrome.cdp.send('Page.navigate', { url: `${srv.base}/public/sounds/ai/manifest.json` });
  await new Promise((r) => setTimeout(r, 800));
  const wyniki = await evaluate(chrome.cdp, `(async () => {
    const pliki = ${JSON.stringify(pliki.map((p) => p.plik))};
    const db = (x) => x > 0 ? 20 * Math.log10(x) : -200;
    const okna = (ch, n, sr, oknoS) => {
      const w = Math.max(1, Math.round(sr * oknoS)); const k = Math.ceil(n / w); const m = new Float64Array(k);
      for (let i = 0; i < k; i++) { const a = i * w, b = Math.min(n, a + w); let s = 0;
        for (const c of ch) for (let j = a; j < b; j++) s += c[j] * c[j];
        m[i] = s / ((b - a) * ch.length); }
      return { m, w };
    };
    const ctx0 = new OfflineAudioContext(2, 44100, 44100);
    const out = [];
    for (const plik of pliki) {
      try {
        const ab = await (await fetch('./' + plik, { cache: 'no-store' })).arrayBuffer();
        const buf = await ctx0.decodeAudioData(ab);
        const sr = buf.sampleRate, n = buf.length;
        const ch = []; for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
        let szczyt = 0; for (const c of ch) for (let i = 0; i < n; i++) { const v = Math.abs(c[i]); if (v > szczyt) szczyt = v; }
        const prog40 = szczyt * Math.pow(10, -40 / 20);
        let pocz = n; for (let i = 0; i < n && pocz === n; i++) for (const c of ch) if (Math.abs(c[i]) > prog40) { pocz = i; break; }
        const o5 = okna(ch, n, sr, 0.005); let max5 = 0; for (const v of o5.m) if (v > max5) max5 = v;
        let atak = -1; for (let i = 0; i < o5.m.length; i++) if (o5.m[i] >= max5 * Math.pow(10, -6 / 10)) { atak = (i + 1) * o5.w / sr * 1000; break; }
        const o10 = okna(ch, n, sr, 0.01); let max10 = 0; for (const v of o10.m) if (v > max10) max10 = v;
        let kon = 0; for (let i = o10.m.length - 1; i >= 0; i--) if (o10.m[i] >= max10 * 1e-4) { kon = Math.min(n, (i + 1) * o10.w) / sr; break; }
        const o50 = okna(ch, n, sr, 0.05); const s50 = Array.from(o50.m).sort((a, b) => a - b);
        const kk = Math.max(1, Math.round(s50.length * 0.25)); let su = 0; for (let i = s50.length - kk; i < s50.length; i++) su += s50[i];
        const rms = Math.sqrt(su / kk);
        // bas < 150 Hz: energia po dwóch filtrach Butterwortha (Q w dB: −3,01 = 0,707 liniowo) / energia całości
        const oc = new OfflineAudioContext(buf.numberOfChannels, n, sr);
        const src = oc.createBufferSource(); src.buffer = buf;
        const f1 = oc.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.value = 150; f1.Q.value = -3.01;
        const f2 = oc.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 150; f2.Q.value = -3.01;
        src.connect(f1); f1.connect(f2); f2.connect(oc.destination); src.start();
        const lp = await oc.startRendering();
        let eAll = 0, eLow = 0;
        for (let c = 0; c < buf.numberOfChannels; c++) { const a = ch[c], b = lp.getChannelData(c);
          for (let i = 0; i < n; i++) { eAll += a[i] * a[i]; eLow += b[i] * b[i]; } }
        out.push({ plik, s: +(n / sr).toFixed(2), szczyt: +db(szczyt).toFixed(1), rms: +db(rms).toFixed(1),
          pocz: Math.round(pocz / sr * 1000), atak: Math.round(atak), koniec: +kon.toFixed(2), bas: Math.round(eAll > 0 ? eLow / eAll * 100 : 0) });
      } catch (e) { out.push({ plik, blad: String(e && e.message || e) }); }
    }
    return out;
  })()`, 600000);
  const byPlik = new Map(pliki.map((p) => [p.plik, p]));
  console.log('plik                      s     szczyt  rms    pocz  atak   koniec  bas%  uwagi');
  for (const w of wyniki) {
    const p = byPlik.get(w.plik);
    if (w.blad) { console.log(`${w.plik.padEnd(25)} BŁĄD ${w.blad}`); continue; }
    const strzal = !p.petla && !/ladowanie/i.test(p.id);
    const uwagi = [];
    if (strzal && w.atak > atakMax) uwagi.push('ATAK');
    if (w.bas > basMax) uwagi.push('BAS');
    if (w.szczyt < -12) uwagi.push('CICHY');
    w.uwagi = uwagi;
    w.id = p.id;
    console.log([w.plik.padEnd(25), String(w.s).padEnd(5), String(w.szczyt).padEnd(7), String(w.rms).padEnd(6),
      String(w.pocz).padEnd(5), String(w.atak).padEnd(6), String(w.koniec).padEnd(7), String(w.bas).padEnd(5), uwagi.join(' ')].join(' '));
  }
  mkdirSync(dirname(out), { recursive: true });
  writeJson(out, wyniki);
  console.log(`\nZapisano ${out}`);
} finally {
  await chrome.close();
  await srv.close();
}
