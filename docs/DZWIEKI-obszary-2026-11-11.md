# Dźwięki obszarów gry, które były nieme (2026-11-11)

Reguła obszaru: `.claude/rules/dzwiek.md` (§ „Dźwięki obszarów”). Tu: rozpoznanie zdarzeń w kodzie, opisy dla
generatora, pomiary plików, kredyty i decyzje podjęte po drodze.

- Tabela gry: `src/audio/dzwiekiSwiata.js` (rozwinięta w `DZWIEKI` / `ZDARZENIA` w `src/audio/dzwiekiLogika.js`).
- Reżyser zdarzeń (czysty, po stronie gry): `src/game/dzwiekiObszarow.js`, testy `tests/dzwiekiObszarow.test.mjs`.
- Lista generatora: `scripts/dzwieki-elevenlabs.lista-swiat.mjs` (wpisy z polem `styl` — bez „cinematic” ze wspólnego
  `STYL`), pomiar plików: `node scripts/dzwieki-pomiar.mjs --tylko <id,id>`.
- Pomiar: długość, szczyt [dBFS], RMS głośnej części, start (−30 dB względem szczytu obwiedni 10 ms), atak (−6 dB),
  słyszalny do (−40 dB), udział energii < 150 Hz (dolnoprzepustowy Butterworth 2×). „Sam bas” > 70%.

## Etap 1 — pliki z manifestu → zdarzenia

### Zdarzenia w grze (wątek gry)

| Obszar | Zdarzenie w kodzie | Moment / czas | Dźwięk |
|---|---|---|---|
| Warp gracza | `warp.state` idle → charging (`startManualWarpCharge`, TRAVEL TO `stepTravelNav`) | ładowanie `warp.chargeTime` = 0,8 s | `warpLadowanie` (1 s) |
| | charging → active (`engageWarp`) | kop | `warpKop` |
| | `warp.state === 'active'` | cały lot (8–17 s Mk III) | pętla `warpTunel` |
| | active → idle (`exitWarp`) | zejście; hamowanie 1,15 s później | `warpZejscie` |
| | charging → idle bez kopu | przerwanie | — (ładowanie trwa 1 s, nie ma czego gasić) |
| Obce okręty | rekord `warpTraffic` `arrival`, `time ≥ fx.t0` | zwiastun 2,4 s × rozmiar przed wyrzutem | `warpZwiastun` |
| | `time ≥ fx.tBrake` (= wyrzut; jak wstrząs `stepWarpBurstShakes`) | wyrzut i hamowanie | `przylotWyrzut` |
| | rekord `departure`, `time ≥ fx.t0` | ładowanie 1,6 + 0,8 × rozmiar s | `warpZwiastun` |
| | `time ≥ fx.tDive` (w punkcie skoku `fx.cx/cy`) | rozpęd i zniknięcie | `warpKop` |
| Maskowanie gracza | `ship.cloak.state` off → engaging | `engageSec` 1,6 s | `maskaWl` |
| | on / engaging → revealing | `revealSec` 0,6 s | `maskaWyl` |
| | nowe `cloak.lastBreak` z `forced` (`breakPlayerCloak`: ogień, taran, trafienie; brak energii) | natychmiast | `maskaZerwanie` |
| Fregata zwiadu | szyna `ScoutBay.on('cloak' / 'cloakBroken')` | 1,2 s / 0,5 s | `maskaWl` / `maskaWyl` / `maskaZerwanie` |
| Rdzeń reaktora | `ReactorGame` `onState` `to === 'meltdown'` (`ev.duration`) | stopienie: eskorta 1,5 s, krążownik 2,5 s, kapitałowy 3,5 s (odcięta komora ×0,5) | pętla `reaktorStopienie`, głośność 0,45 → 1 z postępem |
| | `onDetonate(ev)` (`ev.x, ev.y`) — także śmierć z puli HP (bez zapowiedzi) | detonacja | `reaktorWybuch` |
| Tło mostka | brak widoku mostka w grze — ciche tło w locie (kamera statku, bez pauzy, poza dokiem i halą K-7) | ciągle | pętla `mostek` |
| Interfejs | brak wspólnego nasłuchu — delegacja kliknięć przycisków (menu `#main-menu`, panele) | kliknięcie | `klik` |

Plik `reaktor` (7 s: 3 s narastania, implozja, wybuch) nie pasuje do gry: stopienie trwa 1,5–3,5 s zależnie od klasy, a
śmierć z puli HP i śmierć gracza detonują bez zapowiedzi. Podział: pętla stopienia (głośniej z postępem, gaśnie przy
detonacji) + sama detonacja. Plik `reaktor` zostaje w manifeście, poza warstwą. Tak samo `warpSkok` (4 s ładowania przy
0,8 s w grze), `warpLot`, `warpWyjscie`, `przylot` — w 70–96% basem; zastąpione nowymi id.

### Pomiary (pliki etapu 1; ✗ — wariant poza warstwą, pole `warianty` w tabeli)

| plik | dł. [s] | szczyt | RMS | start | atak | słyszalny do | < 150 Hz | |
|---|---|---|---|---|---|---|---|---|
| warpLadowanie_1 | 1,00 | 0,0 | −12,1 | 0,00 | 0,00 | 1,00 | 0% | |
| warpLadowanie_2 | 1,00 | 0,0 | −11,8 | 0,00 | 0,00 | 0,93 | 0% | |
| warpLadowanie_3 | 1,00 | 0,0 | −10,4 | 0,00 | 0,00 | 0,79 | 13% | |
| warpKop_1 | 1,48 | −3,8 | −17,5 | 0,00 | 0,01 | 0,67 | 22% | |
| warpKop_2 | 1,48 | 0,0 | −11,5 | 0,00 | 0,00 | 0,80 | 48% | |
| warpKop_3 | 1,48 | −0,9 | −13,6 | 0,00 | 0,01 | 0,66 | 97% | ✗ bas |
| warpKop_4 | 1,48 | 0,0 | −11,9 | 0,00 | 0,00 | 0,72 | 64% | |
| warpTunel_1 (pętla) | 8,00 | −2,2 | −14,1 | — | — | 8,00 | 0% | |
| warpTunel_2 (pętla) | 8,00 | 0,0 | −12,0 | — | — | 8,00 | 0% | |
| warpZejscie_1 | 2,00 | 0,0 | −6,9 | 0,00 | 0,15 | 1,92 | 60% | |
| warpZejscie_2 | 2,00 | 0,0 | −7,2 | 0,04 | 0,22 | 1,86 | 73% | ✗ bas |
| warpZejscie_3 | 2,00 | 0,0 | −5,1 | 0,09 | 0,14 | 1,05 | 91% | ✗ bas |
| warpZejscie_4 | 2,00 | −1,3 | −10,1 | 0,00 | 0,00 | 1,63 | 39% | |
| warpZwiastun_1 | 2,48 | 0,0 | −13,2 | 0,32 | 0,70 | 2,19 | 0% | narastanie (zamierzone) |
| warpZwiastun_2 | 2,48 | −0,2 | −14,9 | 0,30 | 0,85 | 2,48 | 0% | narastanie |
| warpZwiastun_3 | 2,48 | 0,0 | −11,6 | 0,64 | 1,32 | 2,45 | 0% | narastanie |
| przylotWyrzut_1 | 1,48 | 0,0 | −13,3 | 0,00 | 0,00 | 1,48 | 3% | |
| przylotWyrzut_2 | 1,48 | −0,1 | −12,9 | 0,00 | 0,00 | 0,65 | 0% | |
| przylotWyrzut_3 | 1,48 | −1,1 | −13,2 | 0,00 | 0,00 | 1,04 | 0% | |
| przylotWyrzut_4 | 1,48 | 0,0 | −11,3 | 0,00 | 0,00 | 1,32 | 17% | |
| reaktorStopienie_1 (pętla) | 5,00 | −12,3 | −23,8 | — | — | 5,00 | 3% | |
| reaktorStopienie_2 (pętla) | 5,00 | −3,0 | −13,6 | — | — | 5,00 | 94% | ✗ bas |
| reaktorStopienie_3 (pętla) | 5,00 | −0,6 | −13,3 | — | — | 5,00 | 0% | |
| reaktorStopienie_4 (pętla) | 5,00 | 0,0 | −12,5 | — | — | 5,00 | 0% | |
| reaktorWybuch_1 | 3,00 | 0,0 | −10,5 | 0,00 | 0,00 | 2,61 | 59% | |
| reaktorWybuch_2 | 3,00 | 0,0 | −7,8 | 0,00 | 0,00 | 2,37 | 57% | |
| reaktorWybuch_3 | 3,00 | 0,0 | −7,1 | 0,00 | 0,07 | 2,14 | 54% | |
| maskaWl_1 | 2,48 | −4,9 | −17,4 | 0,00 | 0,01 | 1,88 | 0% | |
| maskaWl_2 | 2,48 | −0,7 | −18,3 | 0,67 | 0,89 | 1,25 | 0% | ✗ 0,67 s ciszy |
| maskaWl_3 | 2,48 | −4,0 | −18,8 | 0,00 | 0,56 | 1,43 | 0% | narastanie |
| maskaWyl_1 | 2,00 | −7,3 | −22,0 | 0,00 | 0,15 | 1,29 | 0% | |
| maskaWyl_2 | 2,00 | −2,2 | −15,0 | 0,00 | 0,09 | 1,56 | 0% | |
| maskaWyl_3 | 2,00 | −8,9 | −23,7 | 0,00 | 1,06 | 2,00 | 0% | ✗ atak po 1 s |
| maskaZerwanie_1 | 1,76 | −1,9 | −15,7 | 0,00 | 0,00 | 1,44 | 47% | |
| maskaZerwanie_2 | 1,76 | 0,0 | −13,2 | 0,00 | 0,00 | 1,72 | 38% | |
| maskaZerwanie_3 | 1,76 | −0,8 | −19,6 | 0,01 | 0,30 | 1,74 | 0% | ✗ atak po 0,3 s |
| mostek_1 (pętla) | 10,00 | −11,8 | −21,8 | — | — | 10,00 | 96% | ocenione „ok” |
| mostek_2 (pętla) | 10,00 | −11,8 | −21,9 | — | — | 10,00 | 88% | ocenione „ok” |
| klik_1 | 0,48 | −6,0 | −28,5 | 0,01 | 0,23 | 0,27 | 0% | |
| klik_2 | 0,48 | −20,3 | −40,3 | 0,00 | 0,02 | 0,33 | 0% | cichy plik — wyrównanie +18 dB (sufit) |
| klik_3 | 0,48 | −5,6 | −28,5 | 0,00 | 0,12 | 0,17 | 0% | |

### Opisy i kredyty

- Opis ze wspólnym `STYL` („Modern cinematic game sound design…”) i „mid-range, no bass boom” przy świstach warpa
  dawał 79–97% energii < 150 Hz (`warpZejscie`, `przylotWyrzut` — dwa przebiegi). Pomogło dopiero „high and mid
  frequencies only, no low end, no rumble” i własny `styl` wpisu („Clean game sound effect… clear mid and high
  frequencies”).
- Kredyty etapu 1: ok. 975 (103,5 s efektów po ~9,4 kredytu/s — z różnicy konta przy pierwszym przebiegu: 617 za
  65,5 s). W tym ok. 130 na powtórzenie przebiegu ze starymi opisami (mój błąd: skrypt poprawek opisów przerwał się,
  a generacja poszła). Licznik konta jest wspólny z innymi sesjami — zużycie liczę z sekund efektów.
