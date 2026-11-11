#!/usr/bin/env node
// Robocze dźwięki gry z ElevenLabs (efekty dźwiękowe z opisu, POST /v1/sound-generation).
//
//   node scripts/dzwieki-elevenlabs.mjs                         plan i szacunek kosztu — nic nie wysyła
//   node scripts/dzwieki-elevenlabs.mjs --generuj --tylko dzialo,wybuch,klik
//   node scripts/dzwieki-elevenlabs.mjs --generuj               wszystko, czego jeszcze nie ma
//   node scripts/dzwieki-elevenlabs.mjs --konto                 stan kredytów konta
//
// Opcje: --tylko <id,id>   --grupa <nazwa>   --warianty <n> (pliki 1…n; istniejących nie rusza)
//        --nadpisz (generuje od nowa także istniejące)   --max-kredytow <n> (bezpiecznik, domyślnie 5000)
//        --model <id>   --format <format>   --wplyw <0…1> (jak ściśle trzymać się opisu, domyślnie 0,3)
//
// Klucz: zmienna ELEVENLABS_API_KEY (środowisko procesu albo zmienna użytkownika Windows po `setx`).
// Skrypt nigdy nie wypisuje klucza. Pliki: public/sounds/ai/<id>_<n>.mp3 + manifest.json z opisem
// każdego pliku (to treść z generatora AI — katalog i manifest mają to oznaczać). Odsłuch i wybór
// wariantów: dema/dzwieki-ai.html. Lista dźwięków: scripts/dzwieki-elevenlabs.lista.mjs.
//
// AGENT: MP3 ma ciszę kodera na początku i końcu — pętle (`petla`) w MP3 mają słyszalny szew przy
// zapętlaniu w grze; przed wpięciem pętli wygeneruj ją w innym formacie (--format opus_48000_128;
// WAV 44,1 kHz wymaga planu Pro) albo przytnij po zdekodowaniu.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DZWIEKI, STYL } from './dzwieki-elevenlabs.lista.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'sounds', 'ai');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');
const API = 'https://api.elevenlabs.io/v1';

// Z pomiaru 2026-11-11 (plan Creator, model v2, MP3): 2718 kredytów za 245,7 s = ~11,1 kredytu
// za sekundę zadanej długości; tu z zapasem. Dokumentacja API kosztu nie podaje, a cenniki osób
// trzecich mówiły o 40 — po zmianie planu albo modelu sprawdź `--konto` przed i po przebiegu.
const KREDYTY_NA_SEKUNDE = 12;
const LIMIT_OPISU = 450;          // ostrożnie: limit długości opisu nie jest w dokumentacji API
const WARIANTY_KROTKIE = 3;
const WARIANTY_DLUGIE = 2;        // dźwięki od 5 s
const MAX_KREDYTOW_DOMYSLNIE = 5000;
const KOLEJNOSC = new Map(DZWIEKI.map((d, i) => [d.id, i]));

function parseArgs(argv) {
  const o = {
    generuj: false, nadpisz: false, tylko: null, grupa: null, warianty: null,
    maxKredytow: MAX_KREDYTOW_DOMYSLNIE, model: 'eleven_text_to_sound_v2',
    format: 'mp3_44100_128', wplyw: 0.3,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Opcja ${a} wymaga wartości.`);
      return v;
    };
    if (a === '--generuj') o.generuj = true;
    else if (a === '--konto') o.konto = true;
    else if (a === '--nadpisz') o.nadpisz = true;
    else if (a === '--tylko') o.tylko = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--grupa') o.grupa = val().toLowerCase();
    else if (a === '--warianty') o.warianty = Math.max(1, Math.floor(Number(val())));
    else if (a === '--max-kredytow') o.maxKredytow = Number(val());
    else if (a === '--model') o.model = val();
    else if (a === '--format') o.format = val();
    else if (a === '--wplyw') o.wplyw = Number(val());
    else throw new Error(`Nieznana opcja: ${a}`);
  }
  if (!Number.isFinite(o.maxKredytow) || !Number.isFinite(o.wplyw) || o.wplyw < 0 || o.wplyw > 1
    || (o.warianty !== null && !Number.isFinite(o.warianty))) {
    throw new Error('Zła wartość liczbowa w opcjach.');
  }
  return o;
}

function rozszerzenie(format) {
  const rodzaj = format.split('_')[0];
  if (rodzaj === 'mp3' || rodzaj === 'wav' || rodzaj === 'opus') return rodzaj;
  return 'raw';
}

function pelnyOpis(d) {
  return `${d.prompt}. ${STYL}`;
}

// Zadania do wykonania: po jednym na brakujący (albo nadpisywany) plik wariantu.
function plan(o) {
  if (o.tylko) {
    const znane = new Set(DZWIEKI.map((d) => d.id));
    const obce = o.tylko.filter((id) => !znane.has(id));
    if (obce.length) throw new Error(`Nie ma takich dźwięków na liście: ${obce.join(', ')}`);
  }
  const ext = rozszerzenie(o.format);
  const wiersze = [];
  for (const d of DZWIEKI) {
    if (o.tylko && !o.tylko.includes(d.id)) continue;
    if (o.grupa && d.grupa.toLowerCase() !== o.grupa) continue;
    const ile = o.warianty ?? d.warianty ?? (d.s >= 5 ? WARIANTY_DLUGIE : WARIANTY_KROTKIE);
    const zadania = [];
    let gotowe = 0;
    for (let n = 1; n <= ile; n++) {
      const plik = `${d.id}_${n}.${ext}`;
      if (!o.nadpisz && existsSync(path.join(OUT_DIR, plik))) { gotowe++; continue; }
      zadania.push({ d, n, plik });
    }
    wiersze.push({ d, ile, gotowe, zadania });
  }
  return wiersze;
}

function wypiszPlan(wiersze) {
  let sekundy = 0;
  let pliki = 0;
  console.log('id               grupa             s     pętla  do zrobienia  gotowe  ~kredyty');
  for (const w of wiersze) {
    const s = w.d.s * w.zadania.length;
    sekundy += s;
    pliki += w.zadania.length;
    console.log([
      w.d.id.padEnd(16), w.d.grupa.padEnd(17), String(w.d.s).padEnd(5),
      (w.d.petla ? 'tak' : '—').padEnd(6), String(w.zadania.length).padEnd(13),
      String(w.gotowe).padEnd(7), String(Math.round(s * KREDYTY_NA_SEKUNDE)),
    ].join(' '));
    const dl = pelnyOpis(w.d).length;
    if (dl > LIMIT_OPISU) console.log(`  UWAGA: opis ma ${dl} znaków (ostrożny limit ${LIMIT_OPISU}).`);
    if (w.d.s < 0.5 || w.d.s > 30) console.log('  UWAGA: długość poza zakresem API (0,5–30 s).');
  }
  const kredyty = Math.round(sekundy * KREDYTY_NA_SEKUNDE);
  console.log(`\nRazem: ${pliki} plików, ${sekundy.toFixed(1)} s dźwięku, szacunek ~${kredyty} kredytów`
    + ` (${KREDYTY_NA_SEKUNDE} kredytów/s — z pomiaru, nie z cennika).`);
  return { sekundy, pliki, kredyty };
}

function czytajKlucz() {
  const zProcesu = (process.env.ELEVENLABS_API_KEY || '').trim();
  if (zProcesu) return zProcesu;
  if (process.platform === 'win32') {
    // Zmienna użytkownika ustawiona przez `setx` po starcie tego procesu — czytana z rejestru.
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'ELEVENLABS_API_KEY'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/ELEVENLABS_API_KEY\s+REG_\w+\s+(.+)/);
      if (m) return m[1].trim();
    } catch { /* brak zmiennej */ }
  }
  return '';
}

async function stanKonta(klucz) {
  try {
    const r = await fetch(`${API}/user/subscription`, { headers: { 'xi-api-key': klucz } });
    if (!r.ok) return null;
    const j = await r.json();
    const uzyte = Number(j.character_count);
    const limit = Number(j.character_limit);
    if (!Number.isFinite(uzyte) || !Number.isFinite(limit)) return null;
    return { plan: String(j.tier ?? '?'), uzyte, limit, zostalo: limit - uzyte };
  } catch {
    return null;
  }
}

async function opisBledu(r) {
  let tresc = '';
  try { tresc = await r.text(); } catch { /* bez treści */ }
  try {
    const j = JSON.parse(tresc);
    const d = j.detail;
    if (typeof d === 'string') return d;
    if (d && typeof d === 'object') return d.message || d.status || JSON.stringify(d);
  } catch { /* nie JSON */ }
  return tresc.slice(0, 300);
}

const czekaj = (ms) => new Promise((res) => setTimeout(res, ms));

async function generujJeden(klucz, o, d) {
  const body = {
    text: pelnyOpis(d),
    duration_seconds: d.s,
    prompt_influence: d.wplyw ?? o.wplyw,
    loop: !!d.petla,
    model_id: o.model,
  };
  const url = `${API}/sound-generation?output_format=${encodeURIComponent(o.format)}`;
  for (let proba = 1; ; proba++) {
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': klucz, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (proba >= 3) throw new Error(`Brak połączenia z API: ${e.message}`);
      await czekaj(4000 * proba);
      continue;
    }
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    const powod = await opisBledu(r);
    // 429 i 5xx — chwilowe, próba ponowna; reszta (klucz, uprawnienia, kredyty, zły opis) kończy przebieg.
    if ((r.status === 429 || r.status >= 500) && proba < 3) {
      await czekaj(5000 * proba);
      continue;
    }
    throw new Error(`API ${r.status}: ${powod}`);
  }
}

async function czytajManifest() {
  try {
    const j = JSON.parse(await readFile(MANIFEST, 'utf8'));
    if (j && Array.isArray(j.pliki)) return j;
  } catch { /* pierwszy przebieg */ }
  return {
    uwaga: 'Dźwięki robocze wygenerowane przez ElevenLabs (treść z generatora AI). '
      + 'Tworzy je scripts/dzwieki-elevenlabs.mjs.',
    pliki: [],
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.konto) {
    const klucz = czytajKlucz();
    const konto = klucz ? await stanKonta(klucz) : null;
    console.log(konto
      ? `Konto: plan ${konto.plan}, użyto ${konto.uzyte}, zostało ${konto.zostalo} z ${konto.limit} kredytów.`
      : 'Stanu konta nie da się odczytać (brak klucza albo uprawnienia „Użytkownik”).');
    return;
  }
  const wiersze = plan(o);
  if (!wiersze.length) {
    console.log('Filtr nie pasuje do żadnego dźwięku z listy.');
    return;
  }
  const suma = wypiszPlan(wiersze);

  if (!o.generuj) {
    console.log('\nTo tylko plan — nic nie wysłano. Generowanie: dopisz --generuj.');
    return;
  }
  if (!suma.pliki) {
    console.log('\nWszystkie pliki z planu już są. Nowe wersje: --warianty <więcej> albo --nadpisz.');
    return;
  }
  if (suma.kredyty > o.maxKredytow) {
    console.log(`\nSzacunek ~${suma.kredyty} kredytów przekracza bezpiecznik ${o.maxKredytow}. `
      + `Zawęź przebieg (--tylko, --grupa) albo podaj --max-kredytow ${suma.kredyty}.`);
    process.exitCode = 1;
    return;
  }
  const klucz = czytajKlucz();
  if (!klucz) {
    console.log('\nBrak klucza: ustaw zmienną ELEVENLABS_API_KEY (setx ELEVENLABS_API_KEY "…").');
    process.exitCode = 1;
    return;
  }

  const przed = await stanKonta(klucz);
  if (przed) {
    console.log(`\nKonto: plan ${przed.plan}, zostało ${przed.zostalo} z ${przed.limit} kredytów.`);
    if (przed.zostalo < suma.kredyty) {
      console.log(`Za mało kredytów na ten przebieg (szacunek ~${suma.kredyty}). Zawęź przebieg.`);
      process.exitCode = 1;
      return;
    }
  } else {
    console.log('\nStanu konta nie da się odczytać (klucz bez uprawnienia „Użytkownik”) — idę dalej.');
  }

  await mkdir(OUT_DIR, { recursive: true });
  const manifest = await czytajManifest();
  let zrobione = 0;
  try {
    for (const w of wiersze) {
      for (const z of w.zadania) {
        process.stdout.write(`${z.plik} … `);
        const dane = await generujJeden(klucz, o, z.d);
        await writeFile(path.join(OUT_DIR, z.plik), dane);
        manifest.pliki = manifest.pliki.filter((p) => p.plik !== z.plik);
        manifest.pliki.push({
          plik: z.plik, id: z.d.id, wariant: z.n, grupa: z.d.grupa, nazwa: z.d.nazwa, opis: z.d.opis,
          prompt: pelnyOpis(z.d), sekundy: z.d.s, petla: !!z.d.petla,
          model: o.model, format: o.format, wplyw: z.d.wplyw ?? o.wplyw,
          data: new Date().toISOString(),
        });
        // Kolejność jak na liście (strona odsłuchu czyta manifest po kolei), nie jak w przebiegach.
        manifest.pliki.sort((a, b) => (KOLEJNOSC.get(a.id) ?? 1e9) - (KOLEJNOSC.get(b.id) ?? 1e9)
          || a.wariant - b.wariant);
        // Zapis po każdym pliku: przerwany przebieg nie gubi opisu tego, za co już zapłacono.
        await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
        zrobione++;
        console.log(`${(dane.length / 1024).toFixed(0)} kB`);
      }
    }
  } catch (e) {
    console.log(`\nPrzerwano: ${e.message}`);
    process.exitCode = 1;
  }

  const po = await stanKonta(klucz);
  console.log(`\nZapisano ${zrobione} z ${suma.pliki} plików w public/sounds/ai/.`);
  if (przed && po) {
    // Licznik konta odświeża się z opóźnieniem (minuty) — zero tuż po przebiegu nie znaczy „za darmo”.
    console.log(po.uzyte > przed.uzyte
      ? `Zużyto ${po.uzyte - przed.uzyte} kredytów, zostało ${po.zostalo}.`
      : 'Licznik kredytów konta jeszcze się nie odświeżył — stan za kilka minut: --konto.');
  }
  console.log('Odsłuch: http://localhost:5173/dema/dzwieki-ai.html');
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
