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

## Etap 2 — świadomość w walce i lot

| Obszar | Zdarzenie w kodzie | Moment / czas | Dźwięk |
|---|---|---|---|
| Rakiety w gracza | `ciwsStep` po `syncThreats`: bufor `_pdEnemyRocketBuffer`, cel `rb.slot.target` (rakieta 3D) / `rb.target` (pocisk) `=== ship`, `life > 0`, nie `dead` (`liczRakietyNaGracza`) | dopóki leci choć jedna | pętla `rakietyOstrzezenie` (bez położenia) |
| Hipercruise gracza | `hypercruise.state` idle → spool (`startPlayerHypercruise`) | rozruch 2–4 s wg klasy (`driveModes.js`), krótki odcinek TRAVEL TO min. 1 s | `hcRozruch` (2,5 s, narastanie) |
| | spool → active (zdarzenie `'engage'`) | koniec rozruchu | `hcKop` |
| | `state === 'active'` | przelot | pętla `hcLot` |
| | active → drop / idle (`stopPlayerHypercruise`, przechwyt) | hamowanie do 1 000 j/s | `hcWyjscie` |
| Silniki obcych | `npcs`: `npc.thrusterInput.main` ≥ 0,06, dopalacz `npc.__flightIntent.boost`, żywy, w kadrze (`__inDrawBox`), nie ukryty (`SensorSystem.hides`, maska) | co klatkę, 3 najbliższe środka kadru w 1,6 półprzekątnej | synteza `silnikObcy` (przepis silnika MAIN, −12 dB, położenie i filtr odległości z `polozenie`) |

Ostrzeżenie o rakietach a alarmy okrętu: sesja „Włączanie/wyłączanie statku” robi szynę `ShipAlarm`
(`src/game/shipAlarms.js`; alarm MISSILE, priorytet 70 — jeden alarm naraz) z obrazem (koguty, ramka HUD). Dźwięk
ostrzeżenia liczy się z bufora zagrożeń niezależnie od priorytetu alarmów (rakiety w powietrzu przy alarmie kadłuba
też są słyszalne).

### Pomiary

| plik | dł. [s] | szczyt | RMS | start | atak | słyszalny do | < 150 Hz | |
|---|---|---|---|---|---|---|---|---|
| rakietyOstrzezenie_1 (pętla) | 3,00 | −2,9 | −16,5 | — | — | 3,00 | 0% | |
| rakietyOstrzezenie_2 (pętla) | 3,00 | −0,2 | −11,1 | — | — | 3,00 | 0% | |
| rakietyOstrzezenie_3 (pętla) | 3,00 | −7,0 | −17,3 | — | — | 3,00 | 0% | |
| hcRozruch_1 | 2,48 | −0,1 | −6,6 | 0,00 | 0,04 | 2,24 | 8% | |
| hcRozruch_2 | 2,48 | −0,5 | −10,9 | 0,00 | 0,26 | 2,34 | 51% | narastanie |
| hcRozruch_3 | 2,48 | −1,6 | −11,5 | 0,00 | 0,73 | 1,77 | 1% | narastanie |
| hcKop_1 | 1,48 | 0,0 | −9,0 | 0,00 | 0,11 | 0,79 | 72% | ✗ bas |
| hcKop_2 | 1,48 | −0,7 | −12,4 | 0,00 | 0,00 | 0,91 | 25% | |
| hcKop_3 | 1,48 | −0,5 | −11,4 | 0,00 | 0,02 | 0,78 | 31% | |
| hcLot_1 (pętla) | 6,00 | −0,1 | −13,0 | — | — | 6,00 | 0% | |
| hcLot_2 (pętla) | 6,00 | 0,0 | −13,1 | — | — | 6,00 | 0% | |
| hcWyjscie_1 | 1,48 | −0,2 | −4,6 | 0,00 | 0,00 | 1,33 | 64% | |
| hcWyjscie_2 | 1,48 | −0,3 | −8,4 | 0,00 | 0,00 | 1,34 | 57% | |
| hcWyjscie_3 | 1,48 | −1,0 | −11,3 | 0,00 | 0,00 | 0,68 | 67% | |

- `hcLot` z opisem „…airy rushing flow with a soft constant engine whine…” wyszedł w 77–82% basem; bez słowa „engine”
  („…airy rushing hiss with a soft constant high whistle, like air streaming past…”) — 0%.
- Kredyty etapu 2: ok. 465 (49,5 s efektów, w tym 12 s powtórki `hcLot`).

## Etap 3 — myśliwce i hangary

| Obszar | Zdarzenie w kodzie | Moment / czas | Dźwięk |
|---|---|---|---|
| Wyrzut | `ejectFighterFromTube` (gracz: kolejka `updateFighterLaunchQueue`, klawisz Z; NPC: `spawnCarrierFighter`) | co 0,26 s z jednej wyrzutni | `mysliwiecWyrzut` (w miejscu myśliwca po wyrzucie) |
| Przelot | brak zdarzenia — reżyser: najbliższe podejście do środka kadru < 0,4 półprzekątnej, prędkość ≥ 150 j/s | raz na 2,5 s na myśliwca | `mysliwiecPrzelot` |
| Działko | szyna strzałów `WeaponShotBus` ze strzelcem `type` `fighter` / `interceptor` | strzał | `mysliwiecDzialko` (zamiast kategorii broni okrętowej) |
| Rakiety / torpeda myśliwca | ta sama szyna i adapter rakiet | start, wybuch | jak rakiety okrętów (`rakieta`, `wybuchRakiety`) |
| Bomba | `FighterBombs.drop` (zwraca true) | zrzut | `bombaZrzut` |
| | callback `hitHull` (`createFighterBombs`) | wybuch na kadłubie | `bombaWybuch`; `hitShield` → `tarcza` (już jest) |
| Lądowanie | `landFighter` (tylko myśliwce gracza; lotniskowce NPC ich nie przyjmują) | chwyt zaczepu | `mysliwiecLadowanie` |

Silniki myśliwców nie idą przez syntezę obcych okrętów (filtr kleju pomija `fighter` / `interceptor` — przepis
silnika kapitałowego do nich nie pasuje); słychać je przez przelot.

### Pomiary

| plik | dł. [s] | szczyt | RMS | start | atak | słyszalny do | < 150 Hz | |
|---|---|---|---|---|---|---|---|---|
| mysliwiecWyrzut_1 | 1,00 | 0,0 | −9,2 | 0,00 | 0,00 | 0,67 | 0% | |
| mysliwiecWyrzut_2 | 1,00 | 0,0 | −10,6 | 0,00 | 0,00 | 0,66 | 0% | |
| mysliwiecWyrzut_3 | 1,00 | 0,0 | −10,5 | 0,00 | 0,00 | 0,56 | 0% | |
| mysliwiecWyrzut_4 | 1,00 | 0,0 | −9,8 | 0,00 | 0,00 | 0,63 | 0% | |
| mysliwiecPrzelot_1 | 1,48 | 0,0 | −11,0 | 0,00 | 0,00 | 1,39 | 0% | |
| mysliwiecPrzelot_2 | 1,48 | 0,0 | −10,1 | 0,00 | 0,04 | 1,30 | 0% | |
| mysliwiecPrzelot_3 | 1,48 | 0,0 | −8,4 | 0,00 | 0,00 | 1,24 | 0% | |
| mysliwiecPrzelot_4 | 1,48 | 0,0 | −11,1 | 0,00 | 0,00 | 1,08 | 0% | |
| mysliwiecDzialko_1 | 0,48 | 0,0 | −18,3 | 0,00 | 0,01 | 0,15 | 5% | |
| mysliwiecDzialko_2 | 0,48 | −0,6 | −15,6 | 0,00 | 0,00 | 0,11 | 69% | |
| mysliwiecDzialko_3 | 0,48 | −41,6 | −44,6 | 0,00 | 0,00 | 0,48 | 100% | ✗ prawie cisza |
| mysliwiecDzialko_4 | 0,48 | −26,7 | −38,4 | 0,00 | 0,00 | 0,21 | 95% | ✗ cichy bas |
| bombaZrzut_1 | 0,60 | 0,0 | −22,0 | 0,00 | 0,16 | 0,32 | 0% | |
| bombaZrzut_2 | 0,60 | −2,2 | −21,1 | 0,00 | 0,07 | 0,30 | 0% | |
| bombaZrzut_3 | 0,60 | −2,9 | −23,7 | 0,00 | 0,20 | 0,42 | 0% | |
| bombaWybuch_1 | 1,48 | 0,0 | −6,0 | 0,00 | 0,00 | 1,14 | 60% | |
| bombaWybuch_2 | 1,48 | 0,0 | −9,2 | 0,00 | 0,00 | 0,95 | 73% | ✗ bas |
| bombaWybuch_3 | 1,48 | 0,0 | −5,5 | 0,00 | 0,00 | 1,02 | 46% | |
| bombaWybuch_4 | 1,48 | 0,0 | −4,7 | 0,00 | 0,02 | 1,07 | 72% | ✗ bas |
| mysliwiecLadowanie_1 | 1,00 | −3,8 | −22,2 | 0,03 | 0,13 | 0,87 | 0% | |
| mysliwiecLadowanie_2 | 1,00 | 0,0 | −21,1 | 0,02 | 0,07 | 0,67 | 0% | |
| mysliwiecLadowanie_3 | 1,00 | 0,0 | −18,5 | 0,05 | 0,45 | 0,59 | 0% | ✗ atak po 0,45 s |

- Kredyty etapu 3: ok. 215 (22,8 s efektów; licznik konta pokazał 136 tuż po przebiegu — odświeża się z opóźnieniem).

## Etap 4 — praca w przestrzeni

| Obszar | Zdarzenie w kodzie | Dźwięk |
|---|---|---|
| Kopalnia | `MiningRig`: `firing` i dron z `laserOn` | pętla `kopalniaLaser` |
| | `saw.active` i nie `done` | pętla `kopalniaPila` |
| | `tractorOn` (T) | pętla `wiazkaZbiorki` |
| | pierścień `rig.fx` (układ skał, świat = (x, −y)): BLAST / CONTAINED / SPLIT / COLLECT | `skalaWybuch` / `skalaWybuch` ×0,55 / `skalaPekniecie` / `urobekZbior` |
| Łup | `lootContainers.targetCount > 0` (wiązka ZBIÓRKA) | pętla `wiazkaZbiorki` |
| | `env.onCollect(klucz, sztuki, x, y)` | `kontenerZbior` |
| | drony zbierające łup (`loot_drones`) — nie istnieją w grze (`ready: false`) | — |
| Drony naprawcze | pierścień `rig.fx` (`RepairSwarm.rigs`): LAUNCH / DOCK / REGROWN / DRONE_LOST | `dronWylot` / `dronDok` / `dronLata` / `wybuchMaly` ×0,7 |
| | dron w stanie WORK | pętla `dronSpaw` (klucz na rig) |
| Holownik serwisowy | `ServiceTugGame._lockCargo(m, mode)`: `clamp` / `off` | `zaciskiZalaczenie` / `zaciskiZwolnienie` (pliki hali K-7); przylot i odlot — osie warpa, silnik — synteza obcych |
| Kapsuły ratunkowe | pula `stepEscapePods`: liczba PENDING maleje / COAST → FLY | `kapsulaWyrzut` / `kapsulaSilnik` |

### Pomiary

| plik | dł. [s] | szczyt | RMS | start | atak | słyszalny do | < 150 Hz | |
|---|---|---|---|---|---|---|---|---|
| kopalniaLaser_1 | 4,00 | −4,5 | −17,7 | 0,00 | 0,00 | 4,00 | 0% |  |
| kopalniaLaser_2 | 4,00 | 0,0 | −14,9 | 0,00 | 0,00 | 4,00 | 0% |  |
| kopalniaPila_1 | 4,00 | 0,0 | −12,6 | 0,00 | 0,00 | 4,00 | 0% |  |
| kopalniaPila_2 | 4,00 | 0,0 | −11,5 | 0,00 | 0,02 | 4,00 | 0% |  |
| skalaWybuch_1 | 1,48 | 0,0 | −10,7 | 0,00 | 0,00 | 1,12 | 26% |  |
| skalaWybuch_2 | 1,48 | 0,0 | −9,8 | 0,00 | 0,00 | 1,05 | 13% |  |
| skalaWybuch_3 | 1,48 | 0,0 | −12,7 | 0,00 | 0,00 | 1,08 | 31% |  |
| skalaWybuch_4 | 1,48 | 0,0 | −12,8 | 0,00 | 0,00 | 1,08 | 18% |  |
| skalaPekniecie_1 | 1,48 | −0,2 | −14,3 | 0,00 | 0,02 | 1,16 | 36% |  |
| skalaPekniecie_2 | 1,48 | 0,0 | −15,6 | 0,00 | 0,11 | 1,23 | 22% |  |
| skalaPekniecie_3 | 1,48 | 0,0 | −14,5 | 0,00 | 0,00 | 0,95 | 42% |  |
| skalaPekniecie_4 | 1,48 | 0,0 | −11,7 | 0,00 | 0,00 | 1,12 | 59% |  |
| urobekZbior_1 | 0,60 | 0,0 | −13,3 | 0,00 | 0,02 | 0,30 | 9% |  |
| urobekZbior_2 | 0,60 | −6,4 | −19,0 | 0,00 | 0,00 | 0,34 | 96% | ✗ bas |
| urobekZbior_3 | 0,60 | −3,1 | −20,9 | 0,00 | 0,00 | 0,42 | 12% |  |
| wiazkaZbiorki_1 | 4,00 | −3,7 | −15,8 | 0,00 | 0,06 | 4,00 | 58% |  |
| wiazkaZbiorki_2 | 4,00 | −3,2 | −10,4 | 0,00 | 0,13 | 4,00 | 89% | ✗ bas |
| kontenerZbior_1 | 0,80 | 0,0 | −16,9 | 0,00 | 0,37 | 0,53 | 0% | ✗ atak po 0,37 s |
| kontenerZbior_2 | 0,80 | 0,0 | −16,3 | 0,26 | 0,28 | 0,64 | 0% | ✗ start po 0,26 s |
| kontenerZbior_3 | 0,80 | 0,0 | −18,2 | 0,06 | 0,12 | 0,49 | 0% |  |
| dronWylot_1 | 0,60 | −0,1 | −13,3 | 0,00 | 0,00 | 0,42 | 0% |  |
| dronWylot_2 | 0,60 | 0,0 | −10,2 | 0,00 | 0,00 | 0,44 | 0% |  |
| dronWylot_3 | 0,60 | 0,0 | −9,4 | 0,00 | 0,00 | 0,49 | 0% |  |
| dronDok_1 | 0,60 | −2,8 | −15,7 | 0,00 | 0,01 | 0,43 | 0% |  |
| dronDok_2 | 0,60 | 0,0 | −13,2 | 0,00 | 0,00 | 0,54 | 0% |  |
| dronDok_3 | 0,60 | 0,0 | −10,9 | 0,00 | 0,00 | 0,55 | 4% |  |
| dronSpaw_1 | 4,00 | −6,5 | −22,9 | 0,00 | 0,01 | 4,00 | 0% |  |
| dronSpaw_2 | 4,00 | −0,5 | −17,1 | 0,00 | 0,17 | 4,00 | 0% |  |
| dronLata_1 | 0,60 | −2,5 | −16,8 | 0,00 | 0,00 | 0,60 | 0% |  |
| dronLata_2 | 0,60 | −1,3 | −19,7 | 0,00 | 0,01 | 0,06 | 0% | ✗ 0,06 s |
| dronLata_3 | 0,60 | −0,2 | −17,9 | 0,00 | 0,00 | 0,60 | 0% |  |
| kapsulaWyrzut_1 | 0,80 | −4,6 | −21,4 | 0,00 | 0,00 | 0,80 | 0% |  |
| kapsulaWyrzut_2 | 0,80 | −0,5 | −14,2 | 0,00 | 0,00 | 0,50 | 0% |  |
| kapsulaWyrzut_3 | 0,80 | −14,2 | −30,3 | 0,00 | 0,00 | 0,62 | 3% | cichy (RMS −30) |
| kapsulaWyrzut_4 | 0,80 | −44,1 | −58,8 | 0,00 | 0,00 | 0,80 | 22% | ✗ prawie cisza |
| kapsulaSilnik_1 | 1,00 | −1,6 | −14,2 | 0,00 | 0,00 | 0,62 | 0% |  |
| kapsulaSilnik_2 | 1,00 | −3,1 | −16,8 | 0,00 | 0,00 | 1,00 | 0% |  |
| kapsulaSilnik_3 | 1,00 | −0,3 | −13,6 | 0,00 | 0,00 | 0,98 | 0% |  |
| wiazkaZbiorki_3 | 4,00 | −5,2 | −18,5 | 0,00 | 0,00 | 4,00 | 0% |  |
| wiazkaZbiorki_4 | 4,00 | −3,0 | −16,2 | 0,00 | 0,00 | 4,00 | 0% |  |
| kontenerZbior_4 | 0,80 | 0,0 | −13,8 | 0,04 | 0,05 | 0,34 | 1% |  |
| kontenerZbior_5 | 0,80 | −1,2 | −20,1 | 0,06 | 0,14 | 0,57 | 3% |  |

- `wiazkaZbiorki` 3–4 bez „hum” w opisie (0% basu; wariant 2 z „…humming energy field…” — 89%), `kontenerZbior` 4–5 z „the sound starts immediately at the very first moment” (atak 0,05–0,14 s; warianty 1–2 z „with instant attack” — 0,26–0,37 s).
- Kredyty etapu 4: ok. 640 (67,8 s efektów, w tym 9,6 s dogenerowania).

## Etap 5 — interfejs

| Obszar | Zdarzenie w kodzie | Dźwięk |
|---|---|---|
| Menu główne | `menuGamepad.updateHighlight` (klawiatura, pad), `pointerover` na `#main-menu` | `menuFokus` |
| | `setMenuView` (opcje, kampania, powrót) | `menuWidok` |
| | kliknięcie przycisku (`button.menu-btn-styled`, `menuGamepad.confirm`) | `klik` |
| Panele | `openStationUI` / `closeStationUI`, akcja `ui.cicMap` (`CICDisplay.toggle()` — stan po przełączeniu) | `panelOtwarcie` / `panelZamkniecie` |
| | `openStationTerminal` (faza `connecting`) | `terminalPolaczenie` |
| | `handleTrade` przyjęte (kupno, sprzedaż), `purchaseShip`, `handleRepair` | `handelTransakcja`; odmowa (`toast`) — `blad` |
| | przyciski paneli DOM (delegacja `click` na `#top-drawer`, panel wyposażenia) | `klik` |
| Radar i CIC | `triggerScanWave` (skan X) | `skanPing` (+3 dB nad kategorią) |
| | `revealScannerContact` (kontakt odsłonięty falą) | `kontaktBlip` (limit 3, odstęp 90 ms — fala z wieloma kontaktami gra serię) |
| | rozkazy RTS (`issue*Order`, `cicAttackOrder`) | `potwierdzenie` raz na rozkaz (nie na jednostkę) |
| HUD | `pushZoneMessage(…, { label })` | `komunikat` (odstęp 0,4 s) |

Menu przed `startGame` nie ma jeszcze `AudioSys.ctx` (powstaje w `AudioSys.init()`); kliknięcie w menu jest gestem
użytkownika, więc warstwa interfejsu menu może utworzyć kontekst sama — do ustalenia przy hakach z sesją, która włącza
warstwę w zwykłej grze.

### Pomiary

| plik | dł. [s] | szczyt | RMS | start | atak | słyszalny do | < 150 Hz | |
|---|---|---|---|---|---|---|---|---|
| menuFokus_1 | 0,48 | −9,9 | −35,4 | 0,00 | 0,01 | 0,48 | 1% | cichy (RMS −35) |
| menuFokus_2 | 0,48 | −15,7 | −36,8 | 0,00 | 0,00 | 0,48 | 30% | cichy (RMS −37) |
| menuFokus_3 | 0,48 | −11,4 | −29,8 | 0,00 | 0,03 | 0,16 | 0% |  |
| menuWidok_1 | 0,60 | −9,7 | −24,2 | 0,00 | 0,00 | 0,28 | 0% |  |
| menuWidok_2 | 0,60 | −1,0 | −14,2 | 0,12 | 0,30 | 0,56 | 0% | ✗ atak po 0,3 s |
| menuWidok_3 | 0,60 | 0,0 | −10,5 | 0,03 | 0,14 | 0,49 | 50% |  |
| panelOtwarcie_1 | 0,60 | 0,0 | −15,3 | 0,00 | 0,01 | 0,46 | 0% |  |
| panelOtwarcie_2 | 0,60 | −1,5 | −15,3 | 0,00 | 0,00 | 0,47 | 0% |  |
| panelOtwarcie_3 | 0,60 | −3,5 | −15,1 | 0,00 | 0,00 | 0,60 | 0% |  |
| panelZamkniecie_1 | 0,60 | −1,7 | −13,7 | 0,00 | 0,04 | 0,51 | 0% |  |
| panelZamkniecie_2 | 0,60 | −9,1 | −23,7 | 0,00 | 0,00 | 0,53 | 44% |  |
| panelZamkniecie_3 | 0,60 | −4,7 | −19,8 | 0,00 | 0,01 | 0,35 | 0% |  |
| terminalPolaczenie_1 | 0,80 | −1,9 | −13,8 | 0,00 | 0,00 | 0,76 | 0% |  |
| terminalPolaczenie_2 | 0,80 | −3,7 | −17,2 | 0,00 | 0,00 | 0,76 | 0% |  |
| terminalPolaczenie_3 | 0,80 | −1,4 | −14,2 | 0,00 | 0,00 | 0,59 | 0% |  |
| handelTransakcja_1 | 0,60 | −1,5 | −22,3 | 0,00 | 0,02 | 0,34 | 0% |  |
| handelTransakcja_2 | 0,60 | −2,8 | −9,6 | 0,00 | 0,00 | 0,46 | 0% |  |
| handelTransakcja_3 | 0,60 | −2,5 | −9,4 | 0,00 | 0,07 | 0,49 | 0% |  |
| skanPing_1 | 1,48 | −3,8 | −14,7 | 0,00 | 0,00 | 1,11 | 0% |  |
| skanPing_2 | 1,48 | −3,6 | −17,2 | 0,00 | 0,02 | 1,42 | 0% |  |
| skanPing_3 | 1,48 | −10,5 | −20,9 | 0,00 | 0,01 | 1,30 | 0% |  |
| kontaktBlip_1 | 0,48 | −6,6 | −23,9 | 0,00 | 0,00 | 0,28 | 0% |  |
| kontaktBlip_2 | 0,48 | −10,6 | −23,9 | 0,00 | 0,04 | 0,30 | 0% |  |
| kontaktBlip_3 | 0,48 | −2,7 | −15,1 | 0,00 | 0,00 | 0,21 | 0% |  |
| komunikat_1 | 0,60 | −1,8 | −6,6 | 0,00 | 0,00 | 0,60 | 0% |  |
| komunikat_2 | 0,60 | −0,1 | −6,0 | 0,00 | 0,00 | 0,40 | 0% |  |
| komunikat_3 | 0,60 | −0,1 | −12,6 | 0,00 | 0,00 | 0,16 | 0% |  |

- Kredyty etapu 5: ok. 180 (18,9 s efektów).
