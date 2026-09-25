# Benchmark rdzenia — matrix-containment

Tryb killa: **containment** · solver sprężyn: **cpu** · okna sond: **jak gra (z poprawką heksów-duchów)** · dystans 2500 j. (≤ 80% zasięgu broni) · limit 300 s · tarcza zbita · ziarno 20260924
Celowanie: **lock na rdzeń = losowy punkt komory**. Komórki: trafień w kadłub / obrażeń w pulę HP / czas symulacji do progu; „~” = próg wyniszczenia ekstrapolowany (stałe DPS od chwili killa rdzeniem).

| kadłub | broń | kierunek | rdzeń: trafień / obrażeń / czas | wyniszczenie: trafień / obrażeń / czas | rdzeń÷wyniszczenie (obrażenia) | pierwsze | heksów straconych przy killu rdzeniem | trafień do ODSŁONIĘCIA |
|---|---|---|---|---|---|---|---|---|
| Atlas | vulcan_minigun | dziób | > 300.01 s | 3000 / 12000 / 210.3 s | — | wyniszczenie | — | — |
| Atlas | vulcan_minigun | skos | > 300.01 s | 3000 / 12000 / 210.5 s | — | wyniszczenie | — | — |
| Atlas | vulcan_minigun | burta | > 300.01 s | 3000 / 12000 / 210.5 s | — | wyniszczenie | — | — |
| Atlas | vulcan_minigun | rufa | > 300.01 s | 3000 / 12000 / 210.5 s | — | wyniszczenie | — | — |
| Atlas | heavy_autocannon | dziób | > 300.01 s | 429 / 12012 / 214.4 s | — | wyniszczenie | — | — |
| Atlas | heavy_autocannon | skos | > 300.01 s | 429 / 12012 / 214.7 s | — | wyniszczenie | — | — |
| Atlas | heavy_autocannon | burta | > 300.01 s | 429 / 12012 / 214.8 s | — | wyniszczenie | — | — |
| Atlas | heavy_autocannon | rufa | > 300.01 s | 429 / 12012 / 214.7 s | — | wyniszczenie | — | — |
| Atlas | railgun_mk2 | dziób | > 300.01 s | > 300.01 s | — | — | — | — |
| Atlas | railgun_mk2 | skos | > 300.01 s | > 300.01 s | — | — | — | — |
| Atlas | railgun_mk2 | burta | > 300.01 s | > 300.01 s | — | — | — | — |
| Atlas | railgun_mk2 | rufa | > 300.01 s | > 300.01 s | — | — | — | — |
| Atlas | tempest_ion_l | dziób | > 300.01 s | > 300.01 s | — | — | — | — |
| Atlas | tempest_ion_l | skos | > 300.01 s | > 300.01 s | — | — | — | — |
| Atlas | tempest_ion_l | burta | > 300.01 s | > 300.01 s | — | — | — | — |
| Atlas | tempest_ion_l | rufa | > 300.01 s | > 300.01 s | — | — | — | — |
| Atlas | helios_laser | dziób | > 300.01 s | > 300.01 s | — | — | — | — |
| Atlas | helios_laser | skos | > 300.01 s | > 300.01 s | — | — | — | — |
| Atlas | helios_laser | burta | > 300.01 s | > 300.01 s | — | — | — | — |
| Atlas | helios_laser | rufa | > 300.01 s | > 300.01 s | — | — | — | — |
| Atlas | armata_mk1 | dziób | > 300.01 s | 80 / 12000 / 198.1 s | — | wyniszczenie | — | — |
| Atlas | armata_mk1 | skos | > 300.01 s | 80 / 12000 / 198.4 s | — | wyniszczenie | — | — |
| Atlas | armata_mk1 | burta | > 300.01 s | 80 / 12000 / 198.4 s | — | wyniszczenie | — | — |
| Atlas | armata_mk1 | rufa | > 300.01 s | 80 / 12000 / 198.3 s | — | wyniszczenie | — | — |
| Atlas | special_valkyrie_railgun | dziób | > 300.01 s | 24 / 12000 / 69.1 s | — | wyniszczenie | — | — |
| Atlas | special_valkyrie_railgun | skos | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | — |
| Atlas | special_valkyrie_railgun | burta | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | 98 |
| Atlas | special_valkyrie_railgun | rufa | > 300.01 s | 24 / 12000 / 69.1 s | — | wyniszczenie | — | — |
| Atlas | special_yamato_cannon | dziób | > 300.01 s | 15 / 12750 / 20.3 s | — | wyniszczenie | — | — |
| Atlas | special_yamato_cannon | skos | 163 / 138550 / 270.3 s | 15 / 12750 / 20.4 s | 10.867 | wyniszczenie | 440 | 132 |
| Atlas | special_yamato_cannon | burta | 145 / 123250 / 240.3 s | 15 / 12750 / 20.4 s | 9.667 | wyniszczenie | 380 | 118 |
| Atlas | special_yamato_cannon | rufa | > 300.01 s | 15 / 12750 / 20.4 s | — | wyniszczenie | — | 171 |
| Atlas | beam_continuous | dziób | > 300.01 s | 1500 / 12000 / 75.0 s | — | wyniszczenie | — | — |
| Atlas | beam_continuous | skos | 2181 / 17448 / 109.0 s | 1500 / 12000 / 75.0 s | 1.454 | wyniszczenie | 351 | 1713 |
| Atlas | beam_continuous | burta | 2545 / 20360 / 127.2 s | 1500 / 12000 / 75.0 s | 1.697 | wyniszczenie | 332 | 1925 |
| Atlas | beam_continuous | rufa | 3465 / 27720 / 173.2 s | 1500 / 12000 / 75.0 s | 2.31 | wyniszczenie | 465 | 2907 |
| Atlas | beam_pulse | dziób | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Atlas | beam_pulse | skos | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Atlas | beam_pulse | burta | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Atlas | beam_pulse | rufa | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Atlas | siege_torpedo | dziób | > 300.01 s | 15 / 12000 / 170.1 s | — | wyniszczenie | — | — |
| Atlas | siege_torpedo | skos | > 300.01 s | 15 / 12000 / 171.7 s | — | wyniszczenie | — | — |
| Atlas | siege_torpedo | burta | > 300.01 s | 15 / 12000 / 171.7 s | — | wyniszczenie | — | — |
| Atlas | siege_torpedo | rufa | > 300.01 s | 15 / 12000 / 171.4 s | — | wyniszczenie | — | — |
| Atlas | missile_rack | dziób | — | 12 / 12000 / 28.2 s | — | wyniszczenie | — | — |
| Atlas | missile_rack | skos | — | 12 / 12000 / 28.3 s | — | wyniszczenie | — | — |
| Atlas | missile_rack | burta | — | 12 / 12000 / 28.5 s | — | wyniszczenie | — | — |
| Atlas | missile_rack | rufa | — | 12 / 12000 / 28.7 s | — | wyniszczenie | — | — |
| Bellator | vulcan_minigun | dziób | > 300.01 s | 3000 / 12000 / 210.5 s | — | wyniszczenie | — | — |
| Bellator | vulcan_minigun | skos | > 300.01 s | 3000 / 12000 / 210.5 s | — | wyniszczenie | — | — |
| Bellator | vulcan_minigun | burta | > 300.01 s | 3000 / 12000 / 210.5 s | — | wyniszczenie | — | — |
| Bellator | vulcan_minigun | rufa | > 300.01 s | 3000 / 12000 / 210.6 s | — | wyniszczenie | — | 3396 |
| Bellator | heavy_autocannon | dziób | > 300.01 s | 429 / 12012 / 214.7 s | — | wyniszczenie | — | — |
| Bellator | heavy_autocannon | skos | > 300.01 s | 429 / 12012 / 214.8 s | — | wyniszczenie | — | — |
| Bellator | heavy_autocannon | burta | > 300.01 s | 429 / 12012 / 214.8 s | — | wyniszczenie | — | — |
| Bellator | heavy_autocannon | rufa | > 300.01 s | 429 / 12012 / 214.8 s | — | wyniszczenie | — | — |
| Bellator | railgun_mk2 | dziób | > 300.01 s | > 300.01 s | — | — | — | — |
| Bellator | railgun_mk2 | skos | > 300.01 s | > 300.01 s | — | — | — | — |
| Bellator | railgun_mk2 | burta | > 300.01 s | > 300.01 s | — | — | — | — |
| Bellator | railgun_mk2 | rufa | > 300.01 s | > 300.01 s | — | — | — | — |
| Bellator | tempest_ion_l | dziób | > 300.01 s | > 300.01 s | — | — | — | — |
| Bellator | tempest_ion_l | skos | > 300.01 s | > 300.01 s | — | — | — | — |
| Bellator | tempest_ion_l | burta | > 300.01 s | > 300.01 s | — | — | — | — |
| Bellator | tempest_ion_l | rufa | > 300.01 s | > 300.01 s | — | — | — | — |
| Bellator | helios_laser | dziób | > 300.01 s | > 300.01 s | — | — | — | — |
| Bellator | helios_laser | skos | > 300.01 s | > 300.01 s | — | — | — | — |
| Bellator | helios_laser | burta | > 300.01 s | > 300.01 s | — | — | — | — |
| Bellator | helios_laser | rufa | > 300.01 s | > 300.01 s | — | — | — | — |
| Bellator | armata_mk1 | dziób | > 300.01 s | 80 / 12000 / 198.3 s | — | wyniszczenie | — | — |
| Bellator | armata_mk1 | skos | > 300.01 s | 80 / 12000 / 198.4 s | — | wyniszczenie | — | — |
| Bellator | armata_mk1 | burta | > 300.01 s | 80 / 12000 / 198.5 s | — | wyniszczenie | — | — |
| Bellator | armata_mk1 | rufa | > 300.01 s | 80 / 12000 / 198.5 s | — | wyniszczenie | — | — |
| Bellator | special_valkyrie_railgun | dziób | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | — |
| Bellator | special_valkyrie_railgun | skos | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | 92 |
| Bellator | special_valkyrie_railgun | burta | 64 / 32000 / 189.2 s | 24 / 12000 / 69.2 s | 2.667 | wyniszczenie | 206 | 50 |
| Bellator | special_valkyrie_railgun | rufa | 49 / 24500 / 144.2 s | 24 / 12000 / 69.2 s | 2.042 | wyniszczenie | 165 | 31 |
| Bellator | special_yamato_cannon | dziób | 170 / 144500 / 285.3 s | 15 / 12750 / 20.4 s | 11.333 | wyniszczenie | 553 | 157 |
| Bellator | special_yamato_cannon | skos | 115 / 97750 / 190.3 s | 15 / 12750 / 20.4 s | 7.667 | wyniszczenie | 323 | 104 |
| Bellator | special_yamato_cannon | burta | 73 / 62050 / 120.3 s | 15 / 12750 / 20.4 s | 4.867 | wyniszczenie | 211 | 53 |
| Bellator | special_yamato_cannon | rufa | 46 / 39100 / 75.3 s | 15 / 12750 / 20.4 s | 3.067 | wyniszczenie | 171 | 33 |
| Bellator | beam_continuous | dziób | 3391 / 27128 / 169.5 s | 1500 / 12000 / 75.0 s | 2.261 | wyniszczenie | 453 | 2777 |
| Bellator | beam_continuous | skos | 1883 / 15064 / 94.1 s | 1500 / 12000 / 75.0 s | 1.255 | wyniszczenie | 287 | 1389 |
| Bellator | beam_continuous | burta | 1679 / 13432 / 83.9 s | 1500 / 12000 / 75.0 s | 1.119 | wyniszczenie | 199 | 1121 |
| Bellator | beam_continuous | rufa | 1417 / 11336 / 70.8 s | ~1500 / 12000 / 75.0 s | 0.945 | rdzeń | 175 | 887 |
| Bellator | beam_pulse | dziób | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Bellator | beam_pulse | skos | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | 441 |
| Bellator | beam_pulse | burta | 423 / 19035 / 274.3 s | 267 / 12015 / 172.9 s | 1.584 | wyniszczenie | 175 | 284 |
| Bellator | beam_pulse | rufa | 329 / 14805 / 213.2 s | 267 / 12015 / 172.9 s | 1.232 | wyniszczenie | 129 | 197 |
| Bellator | siege_torpedo | dziób | > 300.01 s | 15 / 12000 / 171.4 s | — | wyniszczenie | — | — |
| Bellator | siege_torpedo | skos | > 300.01 s | 15 / 12000 / 171.7 s | — | wyniszczenie | — | — |
| Bellator | siege_torpedo | burta | > 300.01 s | 15 / 12000 / 171.9 s | — | wyniszczenie | — | — |
| Bellator | siege_torpedo | rufa | > 300.01 s | 15 / 12000 / 172.0 s | — | wyniszczenie | — | — |
| Bellator | missile_rack | dziób | — | 12 / 12000 / 28.6 s | — | wyniszczenie | — | — |
| Bellator | missile_rack | skos | — | 12 / 12000 / 28.7 s | — | wyniszczenie | — | — |
| Bellator | missile_rack | burta | — | 12 / 12000 / 28.7 s | — | wyniszczenie | — | — |
| Bellator | missile_rack | rufa | — | 12 / 12000 / 28.8 s | — | wyniszczenie | — | — |
| Iron Skull | vulcan_minigun | dziób | > 300.01 s | 3000 / 12000 / 210.5 s | — | wyniszczenie | — | — |
| Iron Skull | vulcan_minigun | skos | > 300.01 s | 3000 / 12000 / 210.6 s | — | wyniszczenie | — | 3782 |
| Iron Skull | vulcan_minigun | burta | > 300.01 s | 3000 / 12000 / 210.5 s | — | wyniszczenie | — | 4252 |
| Iron Skull | vulcan_minigun | rufa | > 300.01 s | 3000 / 12000 / 210.6 s | — | wyniszczenie | — | 3795 |
| Iron Skull | heavy_autocannon | dziób | > 300.01 s | 429 / 12012 / 214.7 s | — | wyniszczenie | — | — |
| Iron Skull | heavy_autocannon | skos | > 300.01 s | 429 / 12012 / 214.8 s | — | wyniszczenie | — | — |
| Iron Skull | heavy_autocannon | burta | > 300.01 s | 429 / 12012 / 214.8 s | — | wyniszczenie | — | — |
| Iron Skull | heavy_autocannon | rufa | > 300.01 s | 429 / 12012 / 214.8 s | — | wyniszczenie | — | — |
| Iron Skull | railgun_mk2 | dziób | > 300.01 s | > 300.01 s | — | — | — | — |
| Iron Skull | railgun_mk2 | skos | > 300.01 s | > 300.01 s | — | — | — | — |
| Iron Skull | railgun_mk2 | burta | > 300.01 s | > 300.01 s | — | — | — | — |
| Iron Skull | railgun_mk2 | rufa | > 300.01 s | > 300.01 s | — | — | — | — |
| Iron Skull | tempest_ion_l | dziób | > 300.01 s | > 300.01 s | — | — | — | — |
| Iron Skull | tempest_ion_l | skos | > 300.01 s | > 300.01 s | — | — | — | — |
| Iron Skull | tempest_ion_l | burta | > 300.01 s | > 300.01 s | — | — | — | — |
| Iron Skull | tempest_ion_l | rufa | > 300.01 s | > 300.01 s | — | — | — | — |
| Iron Skull | helios_laser | dziób | > 300.01 s | > 300.01 s | — | — | — | — |
| Iron Skull | helios_laser | skos | > 300.01 s | > 300.01 s | — | — | — | — |
| Iron Skull | helios_laser | burta | > 300.01 s | > 300.01 s | — | — | — | — |
| Iron Skull | helios_laser | rufa | > 300.01 s | > 300.01 s | — | — | — | — |
| Iron Skull | armata_mk1 | dziób | > 300.01 s | 80 / 12000 / 198.4 s | — | wyniszczenie | — | — |
| Iron Skull | armata_mk1 | skos | > 300.01 s | 80 / 12000 / 198.4 s | — | wyniszczenie | — | — |
| Iron Skull | armata_mk1 | burta | > 300.01 s | 80 / 12000 / 198.5 s | — | wyniszczenie | — | — |
| Iron Skull | armata_mk1 | rufa | > 300.01 s | 80 / 12000 / 198.5 s | — | wyniszczenie | — | — |
| Iron Skull | special_valkyrie_railgun | dziób | > 300.01 s | 24 / 12000 / 69.2 s | — | wyniszczenie | — | — |
| Iron Skull | special_valkyrie_railgun | skos | 69 / 34500 / 204.2 s | 24 / 12000 / 69.2 s | 2.875 | wyniszczenie | 210 | 51 |
| Iron Skull | special_valkyrie_railgun | burta | 66 / 33000 / 195.2 s | 24 / 12000 / 69.2 s | 2.75 | wyniszczenie | 211 | 52 |
| Iron Skull | special_valkyrie_railgun | rufa | 56 / 28000 / 165.3 s | 24 / 12000 / 69.2 s | 2.333 | wyniszczenie | 190 | 42 |
| Iron Skull | special_yamato_cannon | dziób | 157 / 133450 / 260.5 s | 15 / 12750 / 20.4 s | 10.467 | wyniszczenie | 507 | 145 |
| Iron Skull | special_yamato_cannon | skos | 79 / 67150 / 130.3 s | 15 / 12750 / 20.4 s | 5.267 | wyniszczenie | 220 | 64 |
| Iron Skull | special_yamato_cannon | burta | 66 / 56100 / 105.5 s | 15 / 12750 / 20.4 s | 4.4 | wyniszczenie | 214 | 49 |
| Iron Skull | special_yamato_cannon | rufa | 49 / 41650 / 80.3 s | 15 / 12750 / 20.4 s | 3.267 | wyniszczenie | 186 | 41 |
| Iron Skull | beam_continuous | dziób | 3063 / 24504 / 153.1 s | 1500 / 12000 / 75.0 s | 2.042 | wyniszczenie | 397 | 2437 |
| Iron Skull | beam_continuous | skos | 1291 / 10328 / 64.5 s | ~1500 / 12000 / 75.0 s | 0.861 | rdzeń | 183 | 789 |
| Iron Skull | beam_continuous | burta | 1817 / 14536 / 90.8 s | 1500 / 12000 / 75.0 s | 1.211 | wyniszczenie | 221 | 1121 |
| Iron Skull | beam_continuous | rufa | 1613 / 12904 / 80.6 s | 1500 / 12000 / 75.0 s | 1.075 | wyniszczenie | 201 | 1037 |
| Iron Skull | beam_pulse | dziób | > 300.01 s | 267 / 12015 / 172.9 s | — | wyniszczenie | — | — |
| Iron Skull | beam_pulse | skos | 400 / 18000 / 259.4 s | 267 / 12015 / 172.9 s | 1.498 | wyniszczenie | 173 | 251 |
| Iron Skull | beam_pulse | burta | 420 / 18900 / 272.4 s | 267 / 12015 / 172.9 s | 1.573 | wyniszczenie | 175 | 279 |
| Iron Skull | beam_pulse | rufa | 377 / 16965 / 244.4 s | 267 / 12015 / 172.9 s | 1.412 | wyniszczenie | 154 | 223 |
| Iron Skull | siege_torpedo | dziób | > 300.01 s | 15 / 12000 / 171.5 s | — | wyniszczenie | — | — |
| Iron Skull | siege_torpedo | skos | > 300.01 s | 15 / 12000 / 171.9 s | — | wyniszczenie | — | — |
| Iron Skull | siege_torpedo | burta | > 300.01 s | 15 / 12000 / 171.9 s | — | wyniszczenie | — | — |
| Iron Skull | siege_torpedo | rufa | > 300.01 s | 15 / 12000 / 171.9 s | — | wyniszczenie | — | — |
| Iron Skull | missile_rack | dziób | — | 12 / 12000 / 28.6 s | — | wyniszczenie | — | — |
| Iron Skull | missile_rack | skos | — | 12 / 12000 / 28.7 s | — | wyniszczenie | — | — |
| Iron Skull | missile_rack | burta | — | 12 / 12000 / 28.7 s | — | wyniszczenie | — | — |
| Iron Skull | missile_rack | rufa | — | 12 / 12000 / 28.8 s | — | wyniszczenie | — | — |

Czas liczenia: 2115.1 s
