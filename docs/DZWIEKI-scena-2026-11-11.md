# Scena dźwięków w grze — wdrożenie i pomiar (2026-11-11)

Reguła obszaru: `.claude/rules/dzwiek.md`. Tu: przebieg prac, decyzje po drodze i liczby z harnessu.

## Co powstało

- `?scena=dzwieki` — Atlas z bronią sceny w pustej przestrzeni, sześciu piratów (dwóch przy burtach do taranu, czterech
  w zasięgu ich własnej broni), panel wyboru wariantów i wyciszeń z „Kopiuj wybór”.
- `src/audio/dzwiekiLogika.js` (czysta logika), `src/audio/dzwiekiGry.js` (Web Audio), `src/audio/synteza.js` +
  `src/audio/przepisySyntezy.js` (silnik MAIN i seria CIWS z dema — demo importuje je przez re-eksporty).
- Haki zdarzeń w `index.html` (każdy `if (SND)`), harness `scripts/webgpu/dzwieki-gra.mjs`, testy
  `tests/dzwiekiLogika.test.mjs`.

## Decyzje podjęte po drodze

- Zapis gry: `?scena=dzwieki` zamyka zapis od startu strony do przeładowania (wyposażenie sceny tylko w pamięci —
  odblokowanie po końcu sceny zapisałoby je jako wyposażenie gracza).
- Atlas w scenie nie ginie (kadłub ≥ 1), żeby alarm kadłuba krytycznego dało się słuchać bez końca gry.
- Hexlance poza wyposażeniem sceny (nie ma go na liście zadania) — klawisz 4 daje odmowę (`blad`). Hangary puste
  (myśliwce gracza dokładałyby strzały spoza listy).
- Piraci: własny mózg sceny (trzyma miejsce, strzela tylko z przełącznikiem). Zestaw broni piratów (armata, CIWS) nie
  pokrywa kategorii z listy zdarzeń — piraci sceny dostają broń każdej kategorii (Vulcan, ciężkie działko, wiązka
  ciągła, railgun, laser PD, flak) i wyrzutnie na pancernikach (kadłuby piratów nie mają zaczepów rakietowych w
  edytorze — gniazdo na osi kadłuba). Dalsi piraci stoją najwyżej na 0,7 zasięgu swojej broni main.
- Tarcie i pierwszy kontakt: z nasłuchu dymu zgniotu (`_crushContact`) — nowy `CollisionFX.on` w `index.html` liczy
  się do szwu renderu (`tests/szewRenderu.test.mjs`, grupa konfiguracji / aktualizacji).
- Postawa ognia (Y): „ogień swobodny” (wszystkie wieże na auto strzelają same) = `potwierdzenie`; Ctrl / Alt + 1 / 2 / 3
  (auto grupy wł.) = `potwierdzenie`, wył. = `grupa`.
- Smugi cienia słońca pod okrętami na tle (długie ciemne pasy) to zwykły wygląd gry (maska słońca), nie błąd sceny.
- Cele „niezniszczalne”: pula trzymana na 1 nie wystarcza — Tempest i Yamato niszczą mostki (konanie hulka →
  `finishBridgeKill`) i osłonę komory reaktora (stopienie → detonacja). Cel niezniszczalny cofa `commandLost` w haku
  utraty dowodzenia (mostki zostają martwe) i wypada z kroku `ReactorGame` (`soundSceneReactorList`). Znalezione
  pułapką na polu `dead` piratów w harnessie (stos wywołań w `wyniki.json` → `smierci`).
- Głośność główna gry ma domyślnie 0 (`OPTIONS.audio.master`) — scena gra wtedy z 0,7 (panel to pokazuje); zmiana
  suwaka w opcjach w trakcie sceny idzie do warstwy sceny.

## Pomiar (harness w grze, tryb off, Chrome headless, 1600 × 900)

Wyniki: `.tmp/dzwieki/gra/wyniki.json` (nieśledzone). Ostatnie przebiegi (2026-11-11, po poprawkach):

- Wczytanie: 135 / 135 wariantów (48 id, w scenie używane 34 + 2 z syntezy). Wyrównanie (dB, wariant 1/2/3):
  tempestIon −12,8 / −10,5 / −10,8, railgun ok. −12, yamato −4,5 / −2,8 / −4,5, kadlub +5,1 / −2,2 / +7,7 (najcichsze
  pliki: RMS −26…−29 dB), malowanie +1 / −10,3 / −6,3, alarm −16…−20, blad −18…−22. RMS głośnej części plików przed
  wyrównaniem: od −4 dB (tempestIon, railgun) do −29 dB (malowanie_1, kadlub_3); szczyty po dekodowaniu do +1 dBFS.
- Przebieg pełny (tarcza, grupy 1–5, silnik i dysze, ogień, piraci strzelają, alarm, taran, malowanie, śmierć celów,
  odnowienie): zagrało 36 / 36 dźwięków w jednym przebiegu; w innych 34–35 / 36 — fregata laserowa traciła wszystkie
  wieże pod ogniem Atlasa przed etapem ognia piratów (`laserPD`, `wiazka`; harness odnawia teraz cele przed tym
  etapem), a `rykoszet` zależy od kąta trafienia Vulcanem w pancerz Atlasa (0–17 na przebieg). Konsola bez błędów poza
  brakiem favicon.
- Suma: szczyt na wejściu szyny (przed kompresorem i limiterem) +3,3…+4,7 dBFS, po limiterze −4,1 dB (głośność 0,7)
  / −6,8 dB (0,5); przesterów (szczyt po > −0,04 dB) 0; najwięcej 48–66 głosów naraz (ogień piratów + Atlas).
- Limit głosów (przebieg pełny, głośność 0,7): tempestIon zagrał 352 razy, 1528 startów odrzucił limit (6 głosów
  po ~1 s przy 15 wieżach), 78 przesunął w salwę; autocannon 266 / 1178; kadlub 77 / 2128; trafienie 362 / 1050.
- Zwykła gra (`--tryb zwykla`): warstwa dźwięku nie powstaje, panelu nie ma, zapis otwarty, stary AudioSys ma swoje
  5 dźwięków, 10 s gry bez błędów konsoli.
