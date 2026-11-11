# Dźwięki uzbrojenia — inwentarz, rodziny, generacja i pomiary (2026-11-11)

Zadanie: dźwięki dla całego uzbrojenia poza tym, co miało własny dźwięk, wiązki, odmowa namiaru, ocena w scenie
`?scena=dzwieki`. Stan i zasady: reguła `dzwiek` (§ „Uzbrojenie”). Mapa: `src/audio/dzwiekiBroni.js`, opisy
generatora: `scripts/dzwieki-elevenlabs.lista-bronie.mjs`, test: `tests/dzwiekiBroni.test.mjs`.

## Inwentarz broni (53 wpisy `MASTER_WEAPONS`)

„Przed zmianą” = scena sprzed zadania: gracz — `STRZAL_GRACZA`, reszta (gracz i NPC) — dźwięk kategorii z
`kategoriaBroniNpc`; rakiety — wspólny `rakieta` przy starcie każdej rakiety (Supernova — `supernovaStart`).

| broń (id) | nazwa | kategoria | rozmiar | przed zmianą | teraz |
|---|---|---|---|---|---|
| railgun_mk1 | Tempest Ion Mk I | rail | M | własny: tempestIon | tempestIon |
| railgun_mk2 | Tempest Ion Mk II | rail | M | własny: tempestIon | tempestIon |
| vulcan_minigun | Vulcan Minigun | autocannon | M | kategoria: autocannon | seria z syntezy |
| helios_laser | Helios Laser | plasma | M | kategoria: laserPD | heliosM |
| heavy_autocannon | Heavy Autocannon | autocannon | M | kategoria: autocannon | dzialkoM |
| armata_mk1 | Armata Oblężnicza | armata | L | kategoria: dzialo | armataL |
| beam_continuous | Laser Wiązkowy (Ciągły) | beam | M | kategoria: wiazka | pętla wiazka (+ zapłon wiazkaStart) |
| beam_pulse | Laser Wiązkowy (Puls) | beam | M | kategoria: laserPD | wiazkaPuls |
| tempest_ion_s | Tempest Ion — Lekki | rail | S | własny: tempestIon | tempestIon |
| tempest_ion_l | Tempest Ion — Ciężki | rail | L | własny: tempestIon | tempestIon |
| helios_laser_s | Helios Laser — Lekki | plasma | S | kategoria: laserPD | heliosS |
| helios_lance_l | Helios Lance — Ciężki | plasma | L | kategoria: laserPD | heliosL |
| gatling_s | Gatling — Lekki | autocannon | S | kategoria: autocannon | seria z syntezy |
| heavy_autocannon_l | Heavy Autocannon — Oblężniczy | autocannon | L | kategoria: autocannon | dzialkoL |
| lance_rail_m | Lanca | rail | M | kategoria: railgun | snajperM |
| lance_rail_l | Lanca Ciężka | rail | L | kategoria: railgun | snajperL |
| ciws_mk1 | CIWS Mk I | ciws | S | własny: seria CIWS (synteza) | seria z syntezy |
| laser_pd_mk1 | Helios PD Laser | beam | S | kategoria: laserPD | laserPD |
| ciws_mk2 | CIWS Mk II | ciws | M | własny: seria CIWS (synteza) | seria z syntezy |
| flak_s | Kartacz Flak — Lekki | flak | S | kategoria: flak | flakS |
| flak_m | Kartacz Flak — Średni | flak | M | kategoria: flak | flakM |
| flak_l | Grad Flak — Ciężki | flak | L | kategoria: flak | flakL |
| flak_capital | Zapora Flak "Perun" | flak | Capital | kategoria: flak | flakC |
| missile_rack | Cruise Missile Rack | rocket | M | własny: rakieta | rakieta |
| fast_missile_rack | Fast Missile Rack | rocket | S | rakieta (start rakiety, wspólny) | rakietaS |
| roj_pod | Rój — Kaseta Mikrorakiet | rocket | S | rakieta (start rakiety, wspólny) | rakietaS |
| grad_launcher | Grad — Wyrzutnia Salwowa | rocket | L | rakieta (start rakiety, wspólny) | rakietaL |
| hydra_mirv | Hydra — Rakieta Kasetowa | rocket | M | rakieta (start rakiety, wspólny) | rakieta |
| osa_micro_missile | Osa Mk I | rocket | S | rakieta (start rakiety, wspólny) | rakietaS |
| supernova_missile | Supernova Barrage | rocket | Capital | własny: supernovaStart | supernovaStart |
| fighter_bay | Fighter Bay | hangar | L | kategoria: dzialo | bez dźwięku — hangar — wyrzut myśliwców robi sesja „Dźwięki pozostałych obszarów gry” |
| fighter_squad_interceptor | Interceptor Squadron | hangar | S | kategoria: dzialo | bez dźwięku — hangar — jw. |
| fighter_squad_multirole | Multirole Fighter Squadron | hangar | S | kategoria: dzialo | bez dźwięku — hangar — jw. |
| fighter_squad_strike | Strike Fighter Squadron | hangar | S | kategoria: dzialo | bez dźwięku — hangar — jw. |
| fighter_squad_bomber | Bomber Squadron | hangar | S | kategoria: dzialo | bez dźwięku — hangar — jw. |
| fighter_squad_torpedo | Torpedo Bomber Squadron | hangar | S | kategoria: rakieta | bez dźwięku — hangar — jw. |
| fighter_squad_gunship | Gunship Squadron | hangar | S | kategoria: dzialo | bez dźwięku — hangar — jw. |
| fighter_bomb | Bomba lotnicza | bomb | S | kategoria: autocannon | bez dźwięku — zrzut bomby myśliwca — dźwięk ma wybuch bomby, nie zrzut |
| aerial_torpedo | Torpeda lotnicza | torpedo | S | rakieta (start rakiety, wspólny) | rakietaS |
| gunship_autocannon | Działko kanonierki | autocannon | S | kategoria: autocannon | dzialkoS |
| special_goliath_autocannon | Goliath Autocannon (Special) | autocannon | Capital | kategoria: autocannon | dzialkoC |
| special_plasma_gatling | Ion Plasma Gatling (Special) | plasma | Capital | kategoria: dzialo | plazmaGatling |
| special_valkyrie_railgun | Valkyrie Railgun (Special) | rail | Capital | kategoria: railgun | snajperC |
| special_yamato_cannon | Bateria Główna Klasy YAMATO | plasma | Capital | własny: yamato | yamato |
| hexlance_siege | Hexlance Siege Cannon | superweapon | Capital | nic (strzał poza szyną strzałów; plik `hexlance` ładowanie+strzał w manifeście, niepodpięty) | hexlanceStrzal + ładowanie hexlanceLadowanie |
| death_ray | Gungnir — Promień Śmierci | superweapon | Capital | kategoria: wiazka | promienStrzal + ładowanie promienLadowanie |
| special_valkyrie_s | Kolec — Lekki Railgun Osiowy (Special) | rail | S | kategoria: railgun | snajperS |
| special_valkyrie_m | Oszczep — Railgun Średni (Special) | rail | M | kategoria: railgun | snajperM |
| special_yamato_l | Bateria Dwulufowa Klasy YAMATO (Special) | plasma | L | kategoria: dzialo | yamatoL |
| siege_torpedo | Siege Torpedo Mk I | torpedo | L | rakieta (start rakiety, wspólny) | torpeda |
| siege_torpedo_mk2 | Siege Torpedo Mk II | torpedo | Capital | rakieta (start rakiety, wspólny) | torpedaC |
| torpedo_salvo | Torpedo Salvo Launcher | torpedo | L | rakieta (start rakiety, wspólny) | torpeda |
| siege_railgun | Mjolnir Siege Railgun | rail | Capital | kategoria: railgun (plik `mjolnir` niepodpięty) | mjolnirStrzal + ładowanie mjolnirLadowanie |

## Rodziny × wielkość

| rodzina | S | M | L | Capital |
|---|---|---|---|---|
| działka (autocannon) | `dzialkoS` (kanonierka) | `dzialkoM` | `dzialkoL` | `dzialkoC` (Goliath, special) |
| szybkostrzelne | seria z syntezy (Gatling S) | seria (Vulcan) | — | — |
| armata | — | — | `armataL` | — |
| plazma Helios | `heliosS` | `heliosM` | `heliosL` | `plazmaGatling` (special) |
| plazma Yamato | — | — | `yamatoL` (special) | `yamato` (było) |
| Tempest Ion | `tempestIon` (było) | `tempestIon` | `tempestIon` | — |
| railgun snajperski (Valkyrie, Lanca) | `snajperS` | `snajperM` | `snajperL` | `snajperC` (Valkyrie) |
| superbronie | — | — | — | Mjolnir, Hexlance, promień: ładowanie + strzał osobno |
| wiązki | — | `wiazka` (pętla, było) + `wiazkaStart`, `wiazkaPuls` | — | — |
| flak | `flakS` | `flakM` | `flakL` | `flakC` + `flakRozprysk` (zapalnik) |
| rakiety | `rakietaS` (Osa, Rój, Fast, torpeda lotnicza) | `rakieta` (było; Cruise, Hydra) | `rakietaL` (Grad) | `supernovaStart` (było) |
| torpedy | — | — | `torpeda` | `torpedaC` |

Poziomy: wystrzały w kategorii `dzialo` (−17 dB), broń S −3 dB, broń specjalna +3 dB (`POZIOM_SPECJALNEJ`),
strzały superbroni w `superbron` (−13), ładowanie 3 dB pod wystrzałem, pętle trafienia wiązką w `trafienie`,
rozerwanie flaku i pętla naładowanego Hexlance'a w `drobne`.

## Generacja (ElevenLabs, model `eleven_text_to_sound_v2`, MP3)

- Przebieg 1: 78 z 95 plików, 1175 kredytów. Przerwany przy `flakC_3`: zapis `manifest.json` padł, bo pomiar
  (Chrome czytał `manifest.json` ze statycznego serwera) trzymał plik — NIE mierzyć w trakcie generacji (Windows
  blokuje zapis otwartego pliku). Osierocony `flakC_2.mp3` (bez wpisu w manifeście) usunięty i wygenerowany od nowa.
- Przebieg 2: reszta (rakiety, torpedy, flak) + 9 plików do poprawy z pomiaru: `dzialkoM_2` (atak 70 ms),
  `mjolnirStrzal_2` (75 ms), `hexlanceStrzal_1` (205 ms), `hexlanceGotowy_1` (92% basu), flak S/M/L ciche
  (szczyt −15…−34 dBFS) — 25 plików, 617 kredytów.
- Przebieg 3–5: flak dalej cichy i szpiczasty → opis z „loud and close”, rozerwanie bez „at a distance”; 6 + 2 + 1
  plików (~110 kredytów).
- Konto: przed zadaniem użyte 10 926, po generacji 13 306 → **~2 380 kredytów** (budżet 15 000).

## Pomiary plików (`node scripts/dzwieki-pomiar.mjs --grupa Uzbrojenie`)

Atak = kiedy okno 5 ms dochodzi do (najgłośniejsze okno − 6 dB), od początku pliku; słychać do = koniec ostatniego
okna 10 ms powyżej (najgłośniejsze − 40 dB); bas = udział energii < 150 Hz. Odniesienie: Tempest Ion (oceniony
dobrze) — atak 5 ms, bas 79–88%. Ładowanie (`*Ladowanie`) narasta celowo — atak nie dotyczy.

| dźwięk | pliki | s | szczyt dBFS | RMS dBFS | atak ms | słychać do s | bas < 150 Hz % |
|---|---|---|---|---|---|---|---|
| dzialkoS | 3 | 0.6 | -0.7 / -1.1 / 0 | -20.3 / -17.9 / -13.8 | 40 / 35 / 35 | 0.3 / 0.58 / 0.22 | 0 / 0 / 1 |
| dzialkoM | 3 | 0.68 | -0.2 / 0 / 0 | -24.4 / -14.2 / -14.6 | 5 / 35 / 10 | 0.26 / 0.23 / 0.31 | 0 / 4 / 5 |
| dzialkoL | 3 | 0.88 | 0 / 0 / 0 | -12.1 / -12.6 / -10.8 | 5 / 10 / 60 | 0.52 / 0.64 / 0.53 | 20 / 10 / 40 |
| dzialkoC | 3 | 1.08 | 0 / -6.2 / 0 | -12.6 / -22 / -9.4 | 5 / 5 / 35 | 0.76 / 0.66 / 0.6 | 0 / 5 / 7 |
| armataL | 3 | 1.48 | 0 / -4.2 / 0 | -11 / -22 / -12.2 | 5 / 5 / 5 | 0.71 / 0.81 / 0.87 | 47 / 59 / 34 |
| heliosS | 3 | 0.6 | 0 / 0 / -3.9 | -11.4 / -10.7 / -17.6 | 5 / 5 / 5 | 0.3 / 0.37 / 0.38 | 8 / 14 / 0 |
| heliosM | 3 | 0.8 | -4.2 / 0 / -2.3 | -20.6 / -15 / -16.2 | 5 / 5 / 10 | 0.47 / 0.38 / 0.46 | 2 / 3 / 11 |
| heliosL | 3 | 1 | 0 / 0 / 0 | -11 / -12.4 / -10.3 | 5 / 5 / 5 | 0.56 / 0.55 / 0.62 | 21 / 41 / 58 |
| plazmaGatling | 3 | 0.68 | -5.3 / -6.7 / -4.6 | -20.8 / -24.4 / -17.4 | 5 / 5 / 5 | 0.57 / 0.68 / 0.43 | 18 / 68 / 30 |
| yamatoL | 3 | 1.6 | 0 / 0 / 0 | -9.7 / -9.8 / -11.1 | 5 / 5 / 5 | 0.82 / 0.57 / 0.76 | 33 / 36 / 44 |
| snajperS | 3 | 0.68 | 0 / -6.7 / 0 | -12.8 / -25.3 / -14.4 | 60 / 5 / 5 | 0.23 / 0.42 / 0.4 | 57 / 26 / 26 |
| snajperM | 3 | 1 | 0 / 0 / 0 | -11.2 / -7.7 / -16.6 | 5 / 5 / 5 | 0.55 / 1 / 0.53 | 23 / 50 / 34 |
| snajperL | 3 | 1.28 | 0 / 0 / 0 | -6.8 / -6.7 / -8.1 | 5 / 5 / 5 | 1.03 / 1.01 / 0.98 | 47 / 43 / 26 |
| snajperC | 3 | 1.6 | 0 / 0 / 0 | -7.7 / -6.1 / -6.3 | 5 / 5 / 5 | 1.17 / 1.04 / 1.19 | 46 / 61 / 44 |
| mjolnirLadowanie | 2 | 3.2 | 0 / 0 | -7.5 / -6.7 | 341 / 220 | 2.42 / 2.12 | 58 / 42 |
| mjolnirStrzal | 3 | 2.2 | 0 / 0 / 0 | -5.7 / -6.7 / -6.7 | 45 / 10 / 10 | 1.64 / 1.44 / 1.45 | 39 / 47 / 39 |
| hexlanceLadowanie | 2 | 1.36 | 0 / 0 | -14.1 / -10.8 | 5 / 150 | 1.36 / 1.31 | 2 / 4 |
| hexlanceGotowy | 2 | 3 | -1.7 / -2.3 | -15.8 / -15 | 5 / 15 | 3 / 3 | 0 / 20 |
| hexlanceStrzal | 3 | 2 | 0 / 0 / 0 | -8.5 / -10 / -10.1 | 5 / 5 / 5 | 1.36 / 1.41 / 1.43 | 22 / 7 / 10 |
| promienLadowanie | 2 | 4.16 | -0.3 / -0.4 | -6.3 / -7 | 60 / 5 | 4.13 / 4.09 | 67 / 45 |
| promienStrzal | 2 | 3 | 0 / 0 | -8.5 / -8.2 | 5 / 5 | 2.31 / 2.31 | 29 / 33 |
| wiazkaStart | 3 | 0.68 | -0.4 / 0 / 0 | -13.1 / -10 / -9.5 | 5 / 5 / 5 | 0.51 / 0.68 / 0.65 | 0 / 1 / 9 |
| wiazkaPuls | 3 | 0.68 | 0 / 0 / -1.5 | -9.7 / -11.2 / -17.4 | 5 / 5 / 5 | 0.68 / 0.68 / 0.27 | 0 / 0 / 0 |
| wiazkaKadlub | 2 | 3 | 0 / -2 | -12.9 / -14.3 | 5 / 5 | 3 / 3 | 0 / 0 |
| wiazkaTarcza | 2 | 3 | -2.3 / -1.4 | -16.5 / -14.6 | 5 / 5 | 3 / 3 | 0 / 0 |
| flakS | 3 | 0.6 | 0 / 0 / -0.7 | -8.9 / -15.9 / -22.7 | 25 / 5 / 30 | 0.23 / 0.2 / 0.11 | 28 / 13 / 3 |
| flakM | 3 | 0.8 | 0 / -2.8 / 0 | -10.3 / -16.9 / -12.2 | 55 / 5 / 5 | 0.45 / 0.58 / 0.41 | 50 / 20 / 26 |
| flakL | 3 | 1 | -5.8 / -11.4 / 0 | -18.9 / -26.7 / -7.7 | 5 / 5 / 5 | 0.72 / 0.89 / 0.5 | 22 / 40 / 41 |
| flakC | 3 | 1.2 | 0 / -10.1 / -1.6 | -17.7 / -26.1 / -20.4 | 35 / 5 / 5 | 0.91 / 0.54 / 0.38 | 38 / 29 / 70 |
| flakRozprysk | 3 | 0.6 | -0.1 / 0 / 0 | -23 / -16 / -16 | 185 / 20 / 30 | 0.27 / 0.42 / 0.6 | 5 / 40 / 2 |
| rakietaS | 3 | 1.2 | 0 / 0 / 0 | -5.1 / -11.4 / -9 | 5 / 5 / 5 | 0.94 / 0.68 / 1.03 | 31 / 21 / 16 |
| rakietaL | 3 | 2 | 0 / 0 / 0 | -8.2 / -6.6 / -5.6 | 5 / 15 / 15 | 1.48 / 1.48 / 1.47 | 8 / 24 / 10 |
| torpeda | 3 | 2.2 | 0 / 0 / 0 | -8.1 / -9 / -9 | 5 / 5 / 5 | 1.81 / 1.86 / 1.72 | 1 / 10 / 9 |
| torpedaC | 3 | 2.48 | 0 / 0 / 0 | -7.8 / -7.9 / -7.1 | 15 / 5 / 30 | 1.92 / 2.3 / 2.03 | 26 / 41 / 35 |

Uwagi: `flakRozprysk_1` — atak 185 ms po trzech próbach (dwa pozostałe warianty 20–30 ms); flak L / Capital
(`flakL_2`, `flakC_2`) — szczyt wysoko nad RMS, wyrównanie dociąga je 1–2 dB pod kategorię (sufit szczytu −3 dBFS).
