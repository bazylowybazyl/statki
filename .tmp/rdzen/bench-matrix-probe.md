# Benchmark rdzenia — matrix-probe

Tryb killa: **probe** · solver sprężyn: **cpu** · okna sond: **jak gra (z poprawką heksów-duchów)** · dystans 2500 j. (≤ 80% zasięgu broni) · limit 300 s · tarcza zbita · ziarno 20260924
Celowanie: **lock na rdzeń = losowy punkt komory**. Komórki: trafień w kadłub / obrażeń w pulę HP / czas symulacji do progu; „~” = próg wyniszczenia ekstrapolowany (stałe DPS od chwili killa rdzeniem).

| kadłub | broń | kierunek | rdzeń: trafień / obrażeń / czas | wyniszczenie: trafień / obrażeń / czas | rdzeń÷wyniszczenie (obrażenia) | pierwsze | heksów straconych przy killu rdzeniem | trafień do ODSŁONIĘCIA |
|---|---|---|---|---|---|---|---|---|
| Atlas | special_valkyrie_railgun | dziób | > 300.01 s | 24 / 12000 / 69.1 s | — | wyniszczenie | — | — |
| Atlas | special_valkyrie_railgun | skos | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | — |
| Atlas | special_valkyrie_railgun | burta | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | 98 |
| Atlas | special_valkyrie_railgun | rufa | > 300.01 s | 24 / 12000 / 69.1 s | — | wyniszczenie | — | — |
| Atlas | special_yamato_cannon | dziób | > 300.01 s | 15 / 12750 / 20.3 s | — | wyniszczenie | — | — |
| Atlas | special_yamato_cannon | skos | 153 / 130050 / 250.6 s | 15 / 12750 / 20.4 s | 10.2 | wyniszczenie | 419 | 132 |
| Atlas | special_yamato_cannon | burta | 123 / 104550 / 200.7 s | 15 / 12750 / 20.4 s | 8.2 | wyniszczenie | 339 | 118 |
| Atlas | special_yamato_cannon | rufa | 180 / 153000 / 295.6 s | 15 / 12750 / 20.4 s | 12 | wyniszczenie | 539 | 171 |
| Atlas | beam_pulse | dziób | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Atlas | beam_pulse | skos | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Atlas | beam_pulse | burta | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Atlas | beam_pulse | rufa | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Atlas | beam_continuous | dziób | 5883 / 47064 / 294.1 s | 1500 / 12000 / 75.0 s | 3.922 | wyniszczenie | 896 | — |
| Atlas | beam_continuous | skos | 1661 / 13288 / 83.0 s | 1500 / 12000 / 75.0 s | 1.107 | wyniszczenie | 299 | — |
| Atlas | beam_continuous | burta | 1831 / 14648 / 91.5 s | 1500 / 12000 / 75.0 s | 1.221 | wyniszczenie | 276 | — |
| Atlas | beam_continuous | rufa | 2775 / 22200 / 138.7 s | 1500 / 12000 / 75.0 s | 1.85 | wyniszczenie | 414 | — |
| Bellator | special_valkyrie_railgun | dziób | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | — |
| Bellator | special_valkyrie_railgun | skos | 93 / 46500 / 276.4 s | 24 / 12000 / 69.2 s | 3.875 | wyniszczenie | 294 | 90 |
| Bellator | special_valkyrie_railgun | burta | 56 / 28000 / 165.4 s | 24 / 12000 / 69.2 s | 2.333 | wyniszczenie | 175 | 50 |
| Bellator | special_valkyrie_railgun | rufa | 41 / 20500 / 120.5 s | 24 / 12000 / 69.2 s | 1.708 | wyniszczenie | 137 | 31 |
| Bellator | special_yamato_cannon | dziób | 171 / 145350 / 280.6 s | 15 / 12750 / 20.4 s | 11.4 | wyniszczenie | 520 | 166 |
| Bellator | special_yamato_cannon | skos | 117 / 99450 / 195.5 s | 15 / 12750 / 20.4 s | 7.8 | wyniszczenie | 323 | 104 |
| Bellator | special_yamato_cannon | burta | 69 / 58650 / 110.7 s | 15 / 12750 / 20.4 s | 4.6 | wyniszczenie | 194 | 53 |
| Bellator | special_yamato_cannon | rufa | 45 / 38250 / 70.5 s | 15 / 12750 / 20.4 s | 3 | wyniszczenie | 167 | 33 |
| Bellator | beam_pulse | dziób | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Bellator | beam_pulse | skos | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | 441 |
| Bellator | beam_pulse | burta | 369 / 16605 / 239.4 s | 267 / 12015 / 172.9 s | 1.382 | wyniszczenie | 164 | 284 |
| Bellator | beam_pulse | rufa | 306 / 13770 / 198.5 s | 267 / 12015 / 172.9 s | 1.146 | wyniszczenie | 125 | 197 |
| Bellator | beam_continuous | dziób | 2673 / 21384 / 133.6 s | 1500 / 12000 / 75.0 s | 1.782 | wyniszczenie | 401 | — |
| Bellator | beam_continuous | skos | 1241 / 9928 / 62.0 s | ~1500 / 12000 / 75.0 s | 0.827 | rdzeń | 224 | — |
| Bellator | beam_continuous | burta | 979 / 7832 / 48.9 s | ~1500 / 12000 / 75.0 s | 0.653 | rdzeń | 145 | — |
| Bellator | beam_continuous | rufa | 815 / 6520 / 40.7 s | ~1500 / 12000 / 75.0 s | 0.543 | rdzeń | 124 | — |
| Iron Skull | special_valkyrie_railgun | dziób | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | — |
| Iron Skull | special_valkyrie_railgun | skos | 63 / 31500 / 186.3 s | 24 / 12000 / 69.2 s | 2.625 | wyniszczenie | 192 | 51 |
| Iron Skull | special_valkyrie_railgun | burta | 62 / 31000 / 183.4 s | 24 / 12000 / 69.2 s | 2.583 | wyniszczenie | 199 | 52 |
| Iron Skull | special_valkyrie_railgun | rufa | 51 / 25500 / 150.4 s | 24 / 12000 / 69.2 s | 2.125 | wyniszczenie | 177 | 42 |
| Iron Skull | special_yamato_cannon | dziób | 162 / 137700 / 265.5 s | 15 / 12750 / 20.4 s | 10.8 | wyniszczenie | 504 | 144 |
| Iron Skull | special_yamato_cannon | skos | 86 / 73100 / 140.4 s | 15 / 12750 / 20.4 s | 5.733 | wyniszczenie | 222 | 64 |
| Iron Skull | special_yamato_cannon | burta | 72 / 61200 / 115.5 s | 15 / 12750 / 20.4 s | 4.8 | wyniszczenie | 224 | 48 |
| Iron Skull | special_yamato_cannon | rufa | 54 / 45900 / 85.7 s | 15 / 12750 / 20.4 s | 3.6 | wyniszczenie | 171 | 48 |
| Iron Skull | beam_pulse | dziób | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Iron Skull | beam_pulse | skos | 347 / 15615 / 225.1 s | 267 / 12015 / 172.9 s | 1.3 | wyniszczenie | 157 | 251 |
| Iron Skull | beam_pulse | burta | 369 / 16605 / 239.3 s | 267 / 12015 / 172.9 s | 1.382 | wyniszczenie | 165 | 279 |
| Iron Skull | beam_pulse | rufa | 356 / 16020 / 230.9 s | 267 / 12015 / 172.9 s | 1.333 | wyniszczenie | 147 | 223 |
| Iron Skull | beam_continuous | dziób | 2365 / 18920 / 118.2 s | 1500 / 12000 / 75.0 s | 1.577 | wyniszczenie | 351 | — |
| Iron Skull | beam_continuous | skos | 713 / 5704 / 35.6 s | ~1500 / 12000 / 75.0 s | 0.475 | rdzeń | 130 | — |
| Iron Skull | beam_continuous | burta | 1073 / 8584 / 53.6 s | ~1500 / 12000 / 75.0 s | 0.715 | rdzeń | 165 | — |
| Iron Skull | beam_continuous | rufa | 933 / 7464 / 46.6 s | ~1500 / 12000 / 75.0 s | 0.622 | rdzeń | 145 | — |

Czas liczenia: 654.5 s
