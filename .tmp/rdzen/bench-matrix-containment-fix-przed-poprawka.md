# Benchmark rdzenia — matrix-containment-fix

Tryb killa: **containment** · solver sprężyn: **cpu** · sondy z zapasem na dryf: **tak (poprawka)** · dystans 2500 j. (≤ 80% zasięgu broni) · limit 300 s · tarcza zbita · ziarno 20260924
Celowanie: **lock na rdzeń = losowy punkt komory**. Komórki: trafień w kadłub / obrażeń w pulę HP / czas symulacji do progu; „~” = próg wyniszczenia ekstrapolowany (stałe DPS od chwili killa rdzeniem).

| kadłub | broń | kierunek | rdzeń: trafień / obrażeń / czas | wyniszczenie: trafień / obrażeń / czas | rdzeń÷wyniszczenie (obrażenia) | pierwsze | heksów straconych przy killu rdzeniem | trafień do ODSŁONIĘCIA |
|---|---|---|---|---|---|---|---|---|
| Atlas | special_valkyrie_railgun | dziób | > 300.01 s | 24 / 12000 / 69.1 s | — | wyniszczenie | — | — |
| Atlas | special_valkyrie_railgun | skos | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | — |
| Atlas | special_valkyrie_railgun | burta | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | 100 |
| Atlas | special_valkyrie_railgun | rufa | > 300.01 s | 24 / 12000 / 69.1 s | — | wyniszczenie | — | — |
| Atlas | special_yamato_cannon | dziób | > 300.01 s | 15 / 12750 / 20.3 s | — | wyniszczenie | — | — |
| Atlas | special_yamato_cannon | skos | 107 / 90950 / 175.4 s | 15 / 12750 / 20.4 s | 7.133 | wyniszczenie | 424 | 84 |
| Atlas | special_yamato_cannon | burta | 85 / 72250 / 140.3 s | 15 / 12750 / 20.4 s | 5.667 | wyniszczenie | 387 | 66 |
| Atlas | special_yamato_cannon | rufa | 143 / 121550 / 235.4 s | 15 / 12750 / 20.4 s | 9.533 | wyniszczenie | 566 | 131 |
| Atlas | beam_pulse | dziób | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Atlas | beam_pulse | skos | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Atlas | beam_pulse | burta | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Atlas | beam_pulse | rufa | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Atlas | beam_continuous | dziób | > 300.01 s | 1500 / 12000 / 75.0 s | — | wyniszczenie | — | — |
| Atlas | beam_continuous | skos | 2897 / 23176 / 144.8 s | 1500 / 12000 / 75.0 s | 1.931 | wyniszczenie | 357 | 2273 |
| Atlas | beam_continuous | burta | 3141 / 25128 / 157.0 s | 1500 / 12000 / 75.0 s | 2.094 | wyniszczenie | 342 | 2491 |
| Atlas | beam_continuous | rufa | 4435 / 35480 / 221.7 s | 1500 / 12000 / 75.0 s | 2.957 | wyniszczenie | 472 | 3821 |
| Bellator | special_valkyrie_railgun | dziób | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | — |
| Bellator | special_valkyrie_railgun | skos | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | 88 |
| Bellator | special_valkyrie_railgun | burta | 67 / 33500 / 198.2 s | 24 / 12000 / 69.2 s | 2.792 | wyniszczenie | 216 | 56 |
| Bellator | special_valkyrie_railgun | rufa | 49 / 24500 / 144.2 s | 24 / 12000 / 69.2 s | 2.042 | wyniszczenie | 171 | 35 |
| Bellator | special_yamato_cannon | dziób | 122 / 103700 / 200.4 s | 15 / 12750 / 20.4 s | 8.133 | wyniszczenie | 551 | 116 |
| Bellator | special_yamato_cannon | skos | 72 / 61200 / 115.5 s | 15 / 12750 / 20.4 s | 4.8 | wyniszczenie | 292 | 57 |
| Bellator | special_yamato_cannon | burta | 56 / 47600 / 90.4 s | 15 / 12750 / 20.4 s | 3.733 | wyniszczenie | 206 | 43 |
| Bellator | special_yamato_cannon | rufa | 22 / 18700 / 35.3 s | 15 / 12750 / 20.4 s | 1.467 | wyniszczenie | 146 | 15 |
| Bellator | beam_pulse | dziób | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Bellator | beam_pulse | skos | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Bellator | beam_pulse | burta | 441 / 19845 / 286.0 s | 267 / 12015 / 172.9 s | 1.652 | wyniszczenie | 175 | 299 |
| Bellator | beam_pulse | rufa | 377 / 16965 / 244.4 s | 267 / 12015 / 172.9 s | 1.412 | wyniszczenie | 120 | 244 |
| Bellator | beam_continuous | dziób | 4233 / 33864 / 211.6 s | 1500 / 12000 / 75.0 s | 2.822 | wyniszczenie | 449 | 3497 |
| Bellator | beam_continuous | skos | 3123 / 24984 / 156.1 s | 1500 / 12000 / 75.0 s | 2.082 | wyniszczenie | 317 | 1917 |
| Bellator | beam_continuous | burta | 2159 / 17272 / 107.9 s | 1500 / 12000 / 75.0 s | 1.439 | wyniszczenie | 209 | 1435 |
| Bellator | beam_continuous | rufa | 1877 / 15016 / 93.8 s | 1500 / 12000 / 75.0 s | 1.251 | wyniszczenie | 178 | 1247 |
| Iron Skull | special_valkyrie_railgun | dziób | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | — |
| Iron Skull | special_valkyrie_railgun | skos | 69 / 34500 / 204.2 s | 24 / 12000 / 69.2 s | 2.875 | wyniszczenie | 215 | 51 |
| Iron Skull | special_valkyrie_railgun | burta | 73 / 36500 / 216.2 s | 24 / 12000 / 69.2 s | 3.042 | wyniszczenie | 217 | 56 |
| Iron Skull | special_valkyrie_railgun | rufa | 55 / 27500 / 162.2 s | 24 / 12000 / 69.2 s | 2.292 | wyniszczenie | 190 | 42 |
| Iron Skull | special_yamato_cannon | dziób | 109 / 92650 / 180.3 s | 15 / 12750 / 20.4 s | 7.267 | wyniszczenie | 492 | 100 |
| Iron Skull | special_yamato_cannon | skos | 53 / 45050 / 85.4 s | 15 / 12750 / 20.4 s | 3.533 | wyniszczenie | 208 | 42 |
| Iron Skull | special_yamato_cannon | burta | 51 / 43350 / 80.5 s | 15 / 12750 / 20.4 s | 3.4 | wyniszczenie | 197 | 41 |
| Iron Skull | special_yamato_cannon | rufa | 43 / 36550 / 70.3 s | 15 / 12750 / 20.4 s | 2.867 | wyniszczenie | 192 | 24 |
| Iron Skull | beam_pulse | dziób | > 300.01 s | 267 / 12015 / 189.8 s | — | wyniszczenie | — | — |
| Iron Skull | beam_pulse | skos | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | 346 |
| Iron Skull | beam_pulse | burta | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | 348 |
| Iron Skull | beam_pulse | rufa | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | 270 |
| Iron Skull | beam_continuous | dziób | > 300.01 s | 1500 / 12000 / 112.0 s | — | wyniszczenie | — | 2407 |
| Iron Skull | beam_continuous | skos | 2077 / 16616 / 103.8 s | 1500 / 12000 / 75.0 s | 1.385 | wyniszczenie | 144 | 1197 |
| Iron Skull | beam_continuous | burta | 2637 / 21096 / 131.8 s | 1500 / 12000 / 75.0 s | 1.758 | wyniszczenie | 229 | 1715 |
| Iron Skull | beam_continuous | rufa | 2285 / 18280 / 114.2 s | 1500 / 12000 / 75.0 s | 1.523 | wyniszczenie | 200 | 1437 |

Czas liczenia: 570.8 s
