# E22 — kapsuły ratunkowe

Zadanie z planu ekonomii (`docs/PLAN-ekonomia-rynki.md`, E22). Decyzja użytkownika z 2026-11-08: kapsuły dostają statki, poza pirackimi; statek „umiera”, potem odpala kapsuły, które lecą do stacji. Reguła obszaru: `.claude/rules/kapsuly-ratunkowe.md` (stan i zasady); tu — warianty, kroki i pomiary.

## Warianty domyślne (do decyzji użytkownika — każdy zmienia jeden parametr)

| Sprawa | Wariant domyślny | Dlaczego | Inny wariant |
|---|---|---|---|
| Atlas gracza | bez kapsuł | śmierć gracza kończy grę | kapsuły tylko jako obraz (bez skutku) |
| Hulk mostka | kapsuły przy utracie dowodzenia | okręt bez mostka jest stracony, załoga go opuszcza; przy wraku drugi raz nie | kapsuły dopiero przy wraku (`finishBridgeKill`) |
| Myśliwce i drony | bez kapsuł | pilot ma fotel, dron bez załogi; bitwy myśliwców sypałyby setkami kapsuł | 1 kapsuła na myśliwiec |
| AI, celowanie, pociski | kapsuł nie widzą (duchy) | strzelanie do rozbitków to inna gra (reputacja, prawo); prościej i taniej | trafialne, z karą reputacji |
| Cel portu ringu | zatoka (otwarta na przestrzeń) | hala K-7 ma dach i bramy z boku — prosto z przestrzeni się nie wleci | brama hali K-7 (ścieżka bańki) |
| Daleko od gracza | rozliczenie bez obrazu > 40 tys. j. | kapsuła z 900 j./s leci do stacji minutami | dłużej w obrazie |

## Kroki

- K1 a64309e1 — logika 2D (pula, wyrzut, lot, dolot, piraci bez kapsuł); objazd dysków doków wydzielony z `materializedFlight.js` do `dockDetour.js` (bańka bez zmian zachowania).
- K2 82d66b51 — obraz: partia kapsuł, lampa i płomień, blok migawki `pods`.
- K3 6bcdeea6 — statki ruchu w bańce (encja bez awansu), kapsuły bez obrazu w workerze ruchu (wraki spoza bańki).
- K4 — promy (po wejściu W6 do main): ludzie z kontraktu wracają do magazynu stacji dolotu w chwili dolotu.
- K5 — radar (rodzaj `pod`), mgła wojny, maskowanie (obrys kadłuba), strojenie (kapsuła 20 × 8 j.).

## Pomiary

- Gra, tryb worker (`node scripts/webgpu/kapsuly-gra.mjs --query renderWorker=1`, 2026-11-08): frachtowiec Terra Novy (`long_haul_freighter`, kadłub belek ~650 j.) 72 tys. j. od Ziemi → 3 kapsuły, wyrzut ~1,8 s po śmierci, lot do zatoki ringu Ziemi 86–96 s (bez rozliczenia bez obrazu — gracz leciał obok), 0 próbek w płycie ringu, pirat bez kapsuł; pipeline'y synchroniczne: worker 0, strona 0; błędy 0. Zrzuty: `.tmp/kapsuly/k2`, `.tmp/kapsuly/k2b`.
- K3, gra (`kapsuly-gra.mjs --etapy ruch,pirat`): ciężki frachtowiec Konsorcjum (1800 j.) w bańce, zniszczony bez awansu → 6 kapsuł do Merkurego (najbliższa stacja frakcji), 0 próbek w płycie, pipeline'y synchroniczne 0 / 0, błędy 0. Statek leciał hipercruise'em — kapsuły wzięły jego pęd i od razu wyszły z kadru (zrzuty K5 — statek < 600 j./s).
- K3, worker: `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` przed i po — wynik identyczny (0 linii różnicy poza czasem ticku); test świata ruchu (ziarno 7, 1 h): kapsuły bez obrazu z przechwytów, część już doleciała.
- K5, gra (`kapsuly-gra.mjs --query renderWorker=1 --etapy smierc,ruch,pirat`, zrzuty `.tmp/kapsuly/k5`): frachtowiec Terra Novy → 3 kapsuły, na radarze kokpitu 3 ślady „KAPSUŁA” (`EscapePods.radar`), dolot do zatoki Z08 ringu Ziemi po 86 s, 0 próbek w płycie; prom stacyjny Konsorcjum z redy (bańka, bez awansu) → 1 kapsuła do Merkurego; pirat bez kapsuł; pipeline'y synchroniczne worker 0 / strona 0, błędy 0.
- Kamera fabularna `PortCargo.look` ma kadr najmniej 1000 j. i sama ustawia zoom — najbliższe zbliżenie kapsuły ~20 px; do zrzutu kapsuła zatrzymana w harnessie (kamera dojeżdża ~1 s).
