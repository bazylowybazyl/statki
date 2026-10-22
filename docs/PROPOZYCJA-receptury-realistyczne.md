# PROPOZYCJA — receptury realistyczne (E10)

Spisana 2026-10-22 na prośbę użytkownika: „pomyśl, jak naprawdę wyglądałyby receptury — gdyby takie statki istniały i brali byśmy surowce z kopalni oraz asteroid”. To PROJEKT do rozmowy, nie zmiana gry: kodu nie ruszałem. Stan wyjściowy to lokalny `main` z 2026-10-22 (`c518f23a`): fala 1 scalona (E1, E3, E4, E5, E8), towary `warp_mk1..3` są dopiero w pracy E8.

Plan ekonomii: `docs/PLAN-ekonomia-rynki.md` (zadanie E10 w § 4).

## 0. W skrócie

**Realizm odwraca kilka założeń gry:**
- **Krzem nie jest rzadki.** Jest w każdej skale Układu. Elektronikę ogranicza czystość i fabryka, a rzadkie są domieszki: gal i german (siedzą w metalu żelazo-niklowym planetoid M) oraz ziemie rzadkie.
- **Rzadkie są:** miedź poza Ziemią, ziemie rzadkie, lit, bor, wolfram, ksenon, azot w pasie i fosfor. W grze z tej listy jest tylko miedź.
- **Uran realnie siedzi w zróżnicowanych skorupach:** Księżyc (KREEP), Mars, Ziemia. Ciała Kuipera są prymitywne i mają go śladowo. „Uran tylko w Kuiperze” to decyzja gry, nie realizm.
- **Glin to podstawowy metal statków kosmicznych** (konstrukcja, osłony przeciwodłamkowe, przewody mocy), a w grze go nie ma.
- **Okręt kapitałowy z napędem przelotowym** to realnie reaktor fuzyjny z dyszą magnetyczną. Przy obu jedno i to samo wąskie gardło: magnesy nadprzewodzące (taśma REBCO: ziemie rzadkie, bar, miedź, srebro, podłoże z nadstopu niklu).
- **Paliwo:** reaktor D–He-3 daje mało neutronów, więc nie potrzebuje litu ani grubych osłon. To realny powód, dla którego hel-3 z olbrzymów ma wartość. Pręty uranowe przydają się do rozruchu i jako zapas.
- **Amunicja to azot.** Materiały wybuchowe i miotające (HMX, nitroceluloza) robi się z amoniaku i węgla, więc olbrzymy gazowe i Tytan stają się zapleczem zbrojeniowym.
- **Gra trafiła w kilku miejscach:**
  - chłodziwo z amoniaku (amoniak naprawdę chłodzi zewnętrzne pętle ISS);
  - nadstop niklu na dysze;
  - kompozyt węglowy;
  - katalizator platynowy;
  - woda z planetoid C.

**Wariant pełny (§ 3)** ma ok. 30 surowców, 35 rafinatów i 22 podzespoły. To materiał referencyjny, nie do wdrożenia.

**Grywalny skrót (§ 4)** zachowuje wszystkie obecne klucze. Dochodzi:
- **2 surowce:** ziemie rzadkie, ruda glinu;
- **4 rafinaty:** taśma nadprzewodząca, stop glinu, ceramika pancerna, materiał wybuchowy;
- **1 podzespół:** emiter tarczy.

Do tego zmiany w ok. 15 recepturach i nowa kopalnia na Księżycu. Razem 52 → 59 pozycji (62 z warpem E8).

**Decyzje dla użytkownika** są w § 7.

---

## 1. Inwentarz: co gra ma dziś

### 1.1 Towary (`src/data/resources.js`)

| poziom | klucze | liczba |
|---|---|---|
| T0 surowce z planetoid | `iron_ore`, `copper_ore`, `silicon_ore`, `titanium_ore`, `raw_crystal`, `ice`, `uranium_ore`; rudy z widm: `carbon_ore` (C), `nickel_ore` (M), `platinum_ore` (platynowce) | 10 |
| T0 gazy olbrzymów | `helium3`, `methane`, `ammonia` | 3 |
| T0 z wraków | `scrap` | 1 |
| T1 rafinaty | `steel`, `copper_wire`, `chips`, `titan_alloy`, `optic_lens`, `hydrogen`, `oxygen`, `fuel_rods`, `polymer`, `coolant`, `fusion_fuel`; z pasa (E8): `nickel_superalloy`, `carbon_composite`, `pt_catalyst` | 14 |
| T2 podzespoły | `hull_plate`, `avionics`, `reactor_core`, `thruster`, `weapon_mount`, `life_support`; napędy (E8): `drive_light`, `drive_heavy`, `hypercruise_mk1..3` | 11 |
| T2 uzbrojenie | `gun_ballistic`, `gun_railgun`, `gun_energy`, `gun_plasma`, `launcher_ordnance`, `launcher_torpedo`, `pd_turret`, `flak_turret`, `fighter_craft` | 9 |
| T2 amunicja | `ammo_kinetic`, `flak_shell`, `missile_round`, `torpedo_round` | 4 |
| razem | | **52** |

W pracy E8: `warp_mk1..3` (decyzja 2026-10-22, warp 100–250 tys. j/s).

### 1.2 Receptury (stan dzisiejszy, w skrócie)

Rafineria (T0 → T1):
- stal ← 3 Fe;
- przewód ← 3 Cu;
- układy ← 4 Si (55 s);
- stop Ti ← 4 Ti + 1 stal;
- soczewka ← 3 kryształu;
- H₂ + O₂ ← 2 lodu;
- pręty paliwowe ← 4 U + 1 stal;
- polimer ← 3 metanu;
- chłodziwo ← 2 amoniaku + 1 lód;
- paliwo fuzyjne ← 2 He-3 + 1 H₂;
- stal ← 4 złomu;
- nadstop Ni ← 3 Ni;
- kompozyt ← 3 C + 1 polimer;
- katalizator ← 2 Pt.

Fabryka (T1 → T2): płyta (4 stal + 1 TiA), awionika (2 IC + 2 Cu + 1 opt.), rdzeń reaktora (2 pręty + 2 TiA + 1 chł.), silnik manewrowy (2 płyty + 1 chł. + 2 Cu), podstawa uzbrojenia (2 płyty + 1 awionika + 1 TiA), podtrzymanie życia (1 polimer + 1 O₂ + 1 awionika). Napędy i hipercruise na nadstopie, kompozycie i katalizatorze. Lufy: osiem receptur z E8. Amunicja tylko z rafinatów (decyzja: amunicja nie może konkurować o płyty i awionikę).

Pełna tabela E8 z cenami i rudą T0 na sztukę: raport `E8-receptury.md` w notatkach sesji.

### 1.3 Skąd są surowce

**Planety i księżyce (`PLANET_YIELD`):**

| miejsce | `rate` | urobek |
|---|---|---|
| Merkury | 2,45 | Fe 40%, Ti 36%, Si 12%, Cu 12% |
| Wenus | 1,40 | Cu 45%, Si 25%, kryształ 22%, Fe 8% |
| Ziemia | 0 | nic (hub przemysłowy, decyzja) |
| Mars | 1,05 | Fe 40%, Si 24%, lód 21%, kryształ 15% |
| Jowisz / Saturn / Uran / Neptun | 1,3–1,6 | He-3, amoniak, metan, lód (z księżyców) |
| Ceres | 1,70 | Fe, Si, lód, kryształ, węgiel 26% |
| Westa | 1,95 | Fe, Ti, Si, nikiel 38%, platynowce 8% |
| Io | 0,5 | Fe, Ti, Cu |
| Europa, Enceladus, Tetyda, Ariel | 0,36–0,48 | lód |
| Tytan | 0,54 | metan 62%, amoniak 38% |
| Rea | 0,45 | Fe, Si, lód |
| Tytania | 0,45 | lód, kryształ |
| Oberon | 0,42 | Ti, Fe |
| Tryton | 0,4 | metan, amoniak, kryształ |
| Luna, Fobos, Dejmos, Ganimedes, Kallisto, Mimas | — | węzły bez wydobycia |

**Pas (`ASTEROID_YIELD`, pola E3):**
- typy dawne (Fe, Cu, Si, Ti, kryształ, lód, uran) i z widm: C → `carbon_ore`, M → `nickel_ore`, V (bazalt Westy) → `titanium_ore`, D/P → `ice`, platynowce → `platinum_ore`, C z lodem (Themis) → `ice`;
- skład zmienia się z odległością: wewnętrzny pas S z rodziną Westy, środek S + C z M (szczyt ~38,6 AU mapy), zewnętrzny C, Hildy i Trojańczycy D, Kuiper lód, D, kryształ i uran;
- **uran tylko w Kuiperze** (decyzja, pilnuje test).

**Gazy:** He-3, metan i amoniak z czterech olbrzymów. Metan i amoniak także z Tytana i Trytona. Komety nie dają surowca.

### 1.4 Przemysł stacji (`SYSTEM_INDUSTRY_SPEC`)

| stacja (frakcja) | role |
|---|---|
| Merkury (Konsorcjum Wewnętrzne) | huta |
| Wenus (KW) | huta, elektronika, amunicjownia |
| Ziemia (Terra Nova) | huta, elektronika, stocznia, systemy, zbrojownia |
| Mars (Stocznie Marsjańskie) | huta, elektronika, stocznia, systemy, przetop złomu, zbrojownia |
| Jowisz (Konsorcjum Zewnętrzne) | gazownia, lotne, stocznia, systemy, zakład lotniczy |
| Saturn (KZ) | gazownia, lotne, wzbogacalnia, amunicjownia |
| Uran (KZ) | gazownia, lotne, wzbogacalnia |
| Ceres (Unia Pasa) | huta, elektronika, stocznia, systemy, zakład lotniczy, rafineria pasa |
| Westa (UP) | huta, rafineria pasa |
| księżyce | wydobycie albo węzeł, bez przerobu (decyzja: księżyc daje surowiec, planeta przerabia) |

### 1.5 Uzbrojenie (`MASTER_WEAPONS` → `WEAPON_FAMILY_GOOD`)

| kategoria | przykłady | towar |
|---|---|---|
| `autocannon`, `armata` | Gatling, Vulcan, Heavy Autocannon, Goliath, Armata Oblężnicza | `gun_ballistic` |
| `rail` | Tempest Ion, Lanca, Valkyrie, Mjolnir | `gun_railgun` |
| `beam` | Laser Wiązkowy (ciągły, puls); Helios PD → `pd_turret` | `gun_energy` |
| `plasma`, `superweapon` | Helios Laser / Lance, Ion Plasma Gatling, YAMATO, Hexlance, Gungnir | `gun_plasma` |
| `rocket`, `bomb` | Osa, Rój, Hydra, Grad, Cruise, Supernova, bomba lotnicza | `launcher_ordnance` |
| `torpedo` | Siege Torpedo Mk I/II, salwa, torpeda lotnicza | `launcher_torpedo` |
| `ciws` | CIWS Mk I/II | `pd_turret` |
| `flak` | Kartacz S/M, Grad L, Perun | `flak_turret` |
| `hangar` | Fighter Bay, eskadry | `fighter_craft` |

Rozmiar S/M/L/Capital to liczba sztuk rodziny (1/2/4/8), a nie osobny towar.

### 1.6 Moduły statku — co jest towarem, a co nie

| moduł w grze | towar w gospodarce |
|---|---|
| reaktor (rdzeń R1–R6, `reactorCores.js`) | `reactor_core` |
| mostek (poziomy I–VI) | brak (pośrednio `avionics`) |
| tarcze (`shield_booster` gracza, tarcze okrętów) | **brak** |
| silniki MAIN / WARP / SIDE | MAIN ≈ `drive_light` / `drive_heavy`, SIDE ≈ `thruster`, WARP → `warp_mk1..3` (E8, w pracy) |
| hipercruise Mk1–3 | `hypercruise_mk1..3` |
| hangary, myśliwce | `fighter_craft` (hangar bez towaru) |
| drony naprawcze, rój przeładunkowy | brak |
| zbiorniki paliwa, ładownie | brak |
| podtrzymanie życia | `life_support` |
| moduły gracza (komputer balistyczny, komory rakietowe) | brak (cena stała) |

### 1.7 Składy okrętów (`WARSHIP_CLASSES.build`)

| klasa | płyty | awion. | silniki | reaktor | LSS | podstawy | lufy | inne |
|---|---|---|---|---|---|---|---|---|
| fregata | 4 | 1 | napęd L 1, HC1 1 | — | — | 1 | kin. 1, OP 1 | |
| niszczyciel | 12 | 2 | manewr 1, napęd L 2, HC1 1 | 1 | — | 3 | kin., szyn., las., OP, flak po 1 | |
| krążownik | 30 | 6 | manewr 2, napęd C 2, HC2 1 | 3 | 2 | 7 | kin. 2, szyn. 2, las., plaz., wyrz., OP 2, flak 2 | |
| nosiciel | 60 | 16 | manewr 4, napęd C 4, HC3 1 | 7 | 14 | 7 | 9 luf (w tym torpedy) | myśliwce 18 |

Frachtowce (`FREIGHTER_BUILD`) to na razie tylko dane, bo firmy kupują statki za kredyty.

---

## 2. Realistyczne łańcuchy

Zasada: zaczynam od tego, jak wygląda dzisiejsza albo projektowana technika najbliższa danej rzeczy, a dopiero dla rzeczy fikcyjnych (tarcza, warp) wybieram realny „kotwiczny” materiał. Źródła zebrane są na końcu sekcji ([1]–[30]).

### 2.1 Uzbrojenie

**Działo kinetyczne (autocannon, armata):**
- lufa ze stali działowej (Cr-Mo-V), w ciężkich lufach z wkładką lub chromowaniem;
- zamek, automat ładowania i silniki obrotu wieży: stal, miedź, magnesy NdFeB (ziemie rzadkie);
- pocisk: rdzeń stalowy albo wolframowy (penetrator), materiał miotający z nitrocelulozy lub nitroaminy (azot!), zapalnik z elektroniką.

W kosmosie nie ma powietrza, więc materiał miotający i utleniacz siedzą w łusce: ładunek jest prawie ten sam co na Ziemi.

**Działo szynowe:**
- szyny z miedzi stopowej Cu-Cr albo Cu-W; główny problem to żłobienie i erozja łukiem, więc na powierzchni powłoki W / Mo / Ta [3][4][5];
- armatura (wkładka przewodząca) z glinu, a pocisk z wolframu lub stali;
- pancerna obudowa ściskająca szyny (siły odpychania są ogromne): stal wysokowytrzymała albo nadstop i kompozyt;
- zasilanie impulsowe: banki kondensatorów foliowych (folia polipropylenowa + glin) albo magazyn indukcyjny (cewka nadprzewodząca), do tego przełączniki półprzewodnikowe (krzem, SiC);
- pochłania dużo chłodzenia.

**Emiter laserowy (beam, Helios PD):**
- dzisiejsze lasery bojowe (HELIOS, 60 kW+) to wiązki wielu laserów światłowodowych łączone spektralnie [6];
- ośrodek czynny: włókno krzemionkowe domieszkowane iterbem (ziemie rzadkie) [7], pompowane diodami GaAs / InGaAs (gal, ind, arsen);
- optyka wyjściowa: zwierciadła z SiC lub berylu z powłokami dielektrycznymi, okna szafirowe albo ZnSe, a w podczerwieni german;
- duża część mocy idzie w ciepło, więc potrzebny jest radiator i chłodziwo;
- amunicji nie ma, kosztem jest moc reaktora i zużycie optyki.

**Działo plazmowe** (fikcja z realną kotwicą: wyrzutnia plazmoidów / działo koaksjalne):
- cewki formujące i przyspieszające (nadprzewodnik albo miedź);
- komora z materiału ogniotrwałego (wolfram, C/C-SiC);
- zasilanie impulsowe jak w railgunie;
- „amunicja” to gaz roboczy (deuter, wodór, argon);
- katalizator platynowy realnie tu nie pasuje; platynowce mają sens w elektrodach i stykach wysokoprądowych (iryd, ren, osm są ogniotrwałe i odporne na erozję).

**Wyrzutnie rakiet i torped:**
- rury i prowadnice: glin lub stal, kompozyt;
- rakieta: kadłub CFRP, silnik na stałe paliwo (nadchloran amonu + glin + HTPB, czyli znów azot i glin) albo napęd na ciekłe paliwo;
- głowica naprowadzająca: detektor podczerwieni (InSb, HgCdTe) i optyka germanowa, radar GaN;
- głowica bojowa: HMX / CL-20, a w torpedzie kapitałowej realnie głowica jądrowa (uran / pluton / deuter-tryt).

**CIWS i flak:**
- jak działo kinetyczne, tylko z radarem kierowania ogniem (moduły AESA na azotku galu);
- pociski z zapalnikiem zbliżeniowym (elektronika) i odłamkami (stal, wolfram).

**Myśliwiec:**
- płatowiec ze stopów glinu i tytanu oraz CFRP;
- awionika, silnik, zbiorniki;
- lekki, więc żadnej grubej stali.

### 2.2 Moduły okrętu

**Reaktor fuzyjny:**
- magnesy nadprzewodzące REBCO (REBa₂Cu₃O₇, RE = itr albo gadolin) [1][2]: taśma to podłoże z nadstopu niklu (Hastelloy), warstwy buforowe (tlenki), film REBCO, srebro i miedź. Jedna cewka modelowa SPARC (~10 t) zużyła 270 km taśmy [2]; to dziś wąskie gardło branży;
- kriochłodzenie do ok. 20 K (hel, neon albo wodór jako czynnik);
- pierwsza ściana i diwertor z wolframu (ITER po 2023 r. zrezygnował z berylu na rzecz wolframu) [8][9];
- płaszcz:
  - D–T wymaga płaszcza z litu wzbogaconego w Li-6 (Li-Pb albo FLiBe), a Li-6 jest dziś praktycznie niedostępny komercyjnie [10];
  - D–He-3 (prawie bez neutronów) tego nie potrzebuje, więc jest naturalnym wyborem dla okrętu;
- osłona neutronowa: woda, polietylen, węglik boru, stal;
- radiatory: płyty z glinu lub węgla, pętle chłodziwa (amoniak albo ciekły metal NaK / Li);
- paliwo: deuter (z wody, z komet ponad 3× więcej D niż w oceanach Ziemi [11]) i hel-3 (atmosfery olbrzymów; najłatwiej Uran i Neptun, bo mają płytszą studnię grawitacyjną [12][13]; regolit Księżyca ma He-3 w ilościach ppb [14]).

**Reaktor rozszczepienia / pręty** (pomocniczy): paliwo UO₂ albo TRISO (uran, węgiel, SiC), koszulki ze stopu cyrkonu, moderator (grafit, woda), pręty kontrolne z boru lub hafnu.

**Napęd MAIN i hipercruise** (fuzja z dyszą magnetyczną):
- dysza magnetyczna: cewki nadprzewodzące;
- komora: ściana wolframowa, osłony C/C-SiC;
- masa robocza: wodór lub deuter;
- elementy gorące: nadstopy niklu (typu Inconel) i niob C-103 (Nb-Hf-Ti; dysza modułu Apollo) [15];
- napęd chemiczny (rozruch, awaryjnie): metan + tlen.

**Silniki manewrowe SIDE:**
- realnie mały napęd chemiczny (metalox, hydrazyna) albo silniki Halla / jonowe;
- silniki Halla latają na ksenonie, kryptonie, a Starlink V2 Mini na argonie, bo jest tani [16];
- argon jest w atmosferze Marsa (~1,6–2%), a krypton i ksenon są śladowe wszędzie (0,3 i 0,08 ppm na Marsie) [17]; ksenon ma wzbogacony Jowisz [18];
- materiały: nadstop, niob, ceramika (azotek boru w kanale Halla), magnesy, zawory.

**Warp** (fikcja): realnej techniki nie ma. Kotwica do wyboru: „napęd potrzebuje najsilniejszych pól i największej mocy” → nadprzewodniki (dużo), reaktor, awionika i najrzadszy metal (platynowce lub ziemie rzadkie). Wtedy warp jest najdroższym i najbardziej „pasowo-księżycowym” modułem.

**Tarcza** (fikcja): kotwica realna to osłona magnetyczna przed promieniowaniem (cewki nadprzewodzące) plus plazma lub bank energii. Materiały: nadprzewodnik, kondensatory (folia + glin), radiatory, awionika.

**Pancerz i płyty kadłuba:**
- osłona Whipple'a z wypełnieniem (ISS): zderzak z glinu, mata z 6 warstw tkaniny Nextel (ceramika Al₂O₃-B₂O₃-SiO₂) i 6 warstw Kevlaru, ściana z glinu jako łapacz; zatrzymuje odłamek 1,3 cm [19][20];
- pancerz balistyczny: ceramika (węglik boru, węglik krzemu, korund) na podkładzie z aramidu lub UHMWPE [21];
- konstrukcja: stal i tytan na węzły i belki, glin i CFRP na poszycie;
- dla okrętu w kosmosie pancerz to warstwy (ceramika + kompozyt + metal), a nie gruba stal.

**Elektronika, mostek, awionika:**
- krzem (najwyższa czystość, wymaga dużo energii);
- gal i german: GaN do radarów i zasilaczy, Ge do podczerwieni. Oba naturalnie wchodzą do metalu żelazo-niklowego; meteoryty żelazne klasyfikuje się po zawartości Ga, Ge i Ir [22];
- złoto i srebro na styki, miedź na ścieżki, tantal na kondensatory;
- ziemie rzadkie: magnesy, luminofory, lasery;
- ind (ITO w wyświetlaczach);
- tlen i chlor jako odczynniki.

**Podtrzymanie życia:**
- woda (lód) jako zapas, osłona i źródło tlenu (elektroliza);
- azot jako gaz buforowy (z amoniaku albo z atmosfery Tytana, która ma ok. 95% N₂ [23]);
- węgiel i reakcja Sabatiera na katalizatorze niklowym lub rutenowym (CO₂ + H₂ → CH₄ + H₂O);
- filtry z węgla aktywnego, polimery na zbiorniki i membrany;
- do żywności fosfor i potas (KREEP, chondryty).

**Paliwo i zbiorniki:** ciekły wodór i tlen w zbiornikach z Al-Li albo CFRP z izolacją wielowarstwową (kapton, glin).

**Drony i hangary:** jak myśliwiec, tylko mniejsze; dużo elektroniki i baterii (lit lub ogniwa paliwowe).

### 2.3 Skąd jest każdy pierwiastek w Układzie Słonecznym

| surowiec | gdzie realnie | rzadkość | uwagi dla gry |
|---|---|---|---|
| Fe, Ni, Co | planetoidy M (metal Fe-Ni) [24], ziarna metalu w S, hematyt Marsa | pospolity | Merkury ma żelazo w jądrze, a powierzchnię UBOGĄ w Fe (1–2% wag.) [25] |
| platynowce (Pt, Pd, Ir, Os, Rh, Ru), Au, Re | metal M i meteoryty żelazne, CAI w chondrytach | bardzo rzadki | Westa i pola M w pasie — zgodne z grą |
| Ga, Ge | metal Fe-Ni (pierwiastki syderofilne) [22] | rzadki | nowe powiązanie: pas → elektronika |
| W, Mo | metal M, ogniotrwałe wtrącenia CAI w chondrytach C/CV [26] | rzadki | w kosmosie bez dobrego złoża |
| Si, Mg, O | wszystkie skały krzemianowe | pospolity | krzem nie powinien być wąskim gardłem |
| Ti | ilmenit mórz księżycowych (do kilkunastu % TiO₂) [27], bazalty Westy (eukryty) | średni | Luna jest najlepszym źródłem, którego gra nie używa |
| Al | anortyt wyżyn księżycowych [27], plagioklaz eukrytów Westy [28] | pospolity, trudny w przerobie | w grze nie ma glinu |
| Cu | w ciałach niezróżnicowanych mało (~100 ppm), więcej w siarczkach metalu M; na Ziemi i Marsie złoża hydrotermalne | rzadki | miedź Wenus to fikcja (powierzchnia 460 °C, 90 bar) |
| ziemie rzadkie (Y, Nd, Gd, Yb…), Th, U, P, K | KREEP Księżyca (Oceanus Procellarum) [29], skorupa Marsa | rzadkie | Luna jako jedyne naprawdę bogate źródło poza Ziemią |
| U | KREEP, Mars, Ziemia; w Kuiperze śladowo (chondrytowo) | rzadki | decyzja gry „uran tylko w Kuiperze” jest przeciwna realizmowi |
| Li | skorupy Ziemi i Marsa; chondryty ~1,5 ppm | bardzo rzadki | omijać (fuzja D–He-3 zamiast D–T) |
| B | ewaporaty Ziemi, bor w Gale na Marsie | bardzo rzadki | węglik boru może zastąpić korund i SiC |
| C | planetoidy C i D, komety, metan Tytana, CO₂ Marsa i Wenus | pospolity | zgodne |
| H₂O, D | C (4,5% wody średnio w pasie, CI do 17%) [30], Ceres, księżyce lodowe, komety (D/H ponad 3× ziemskie) [11] | pospolity | deuter z wody komet i Kuipera |
| N | Tytan (atmosfera ~95% N₂) [23], Tryton i Pluton (lód N₂), amoniak olbrzymów i Ceres, Wenus 3,5% N₂ | lokalny | azot to amunicja i gaz buforowy |
| NH₃ | olbrzymy, Ceres (glinki amonowe, węglan sodu w Occator), komety | lokalny | zgodne |
| CH₄ | Tytan, Uran, Neptun, Tryton | lokalny | zgodne |
| He-3 | olbrzymy (Uran i Neptun najłatwiejsze) [12][13], regolit Księżyca (ppb) [14] | rzadki | zgodne |
| Ar | atmosfera Marsa ~2% [17] | lokalny | napęd SIDE na argonie (opcja) |
| Xe, Kr | wszędzie śladowo, Jowisz wzbogacony [18] | bardzo rzadki | omijać |
| S | Io (wulkany siarkowe), powierzchnia Merkurego (≥10× więcej niż Ziemia i Księżyc) [25], chmury Wenus (H₂SO₄) | lokalny | odczynnik, nie produkt |
| kryształ / minerały optyczne | korund, kwarc, beryl; realna optyka laserowa jest syntetyczna (szafir, YAG, szkło kwarcowe) | — | `raw_crystal` jako „minerały optyczne” |

### Źródła sekcji 2

- [1] Fusion Magnets (przegląd REBCO): https://technotrends.burrus.com/articles/2021/June/Fusion-Magnets.html
- [2] Design, Fabrication, and Assembly of the SPARC Toroidal Field Model Coil (Princeton): https://collaborate.princeton.edu/en/publications/design-fabrication-and-assembly-of-the-sparc-toroidal-field-model/ ; rekord 20 T: https://cold-facts.org/2024/09/11/tests-show-high-temperature-superconducting-magnets-ready-for-fusion/
- [3] Advanced Rail Materials for Electromagnetic Launchers (Navy SBIR): https://www.navysbir.com/n10_1/N101-086.htm
- [4] Patent: stopy Cu-Cr i Cu-W jako materiał szyn: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5133242
- [5] Badania par W / Cu / Ag (DTIC): https://apps.dtic.mil/sti/pdfs/ADP012477.pdf ; przegląd zużycia szyn: https://www.mater-rep.com/EN/Y2018/V32/I1/135
- [6] HELIOS — łączenie spektralne laserów światłowodowych (Lockheed Martin): https://news.lockheedmartin.com/2021-01-11-Lockheed-Martin-Delivers-HELIOS-Laser-Weapon-System-to-US-Navy-for-Ship-Testing-and-Integration ; Navy SBIR (Aculight): https://www.navysbir.com/success/docs\Aculight-SSL-23.pdf
- [7] Lasery światłowodowe, domieszki iterbu (przegląd, Wikipedia): https://en.wikipedia.org/wiki/Fiber_laser
- [8] ITER — pierwsza ściana i diwertor: https://physicsworld.com/a/tritium-deuterium-plasma-puts-the-heat-on-iters-first-wall/
- [9] Rebaseline ITER 2023: wolfram zamiast berylu: https://openrepository.mephi.ru/bitstreams/a73c76c8-404c-4608-954b-be536ff3bc8c/download ; ściana JET: https://archive.aps.org/dpp/2011/no4/5
- [10] Płaszcze rozpłodowe, Li-6: https://en.wikipedia.org/wiki/Breeding_blanket ; INFUSE (ORNL): https://infuse.ornl.gov/awards/isotopic-characterization-of-li-6-enriched-lithium-lead-samples-under-neutron-irradiation/
- [11] ESA / Rosetta, D/H komety 67P: https://www.esa.int/ESA_Multimedia/Images/2014/12/First_measurements_of_comet_s_water_ratio ; Altwegg i in., Science 2015: https://wurz.space.unibe.ch/Altwegg_Science_2015.pdf
- [12] NASA NTRS, górnictwo atmosfer układu zewnętrznego: https://ntrs.nasa.gov/citations/20140017392
- [13] Project Icarus, paliwo z olbrzymów: https://www.centauri-dreams.org/2010/09/28/project-icarus-finding-the-fuel/ ; Uran: https://www.centauri-dreams.org/2011/06/01/starship-fuel-from-the-outer-system
- [14] Hel-3, regolit Księżyca (przegląd, Wikipedia): https://en.wikipedia.org/wiki/Helium-3
- [15] Niob C-103, dysza silnika lądownika Apollo: https://gsalloy.com/niobium-c-103-alloy-composition-properties-applications-in-high-temperature-aerospace/
- [16] Alternatywne paliwa silników Halla (Southampton): https://eprints.soton.ac.uk/483809/1/Review_of_Alternative_Propellants_in_Hall_Thrusters_Comment_Response_NC.pdf ; Aerospace America 2023: https://epizodyspace.ru/bibl/inostr-yazyki/aerospace-america/2023/11/Oh_Neumann_A_year_of_firsts_for_electric_propulsion_Aerospace_America_61_no_11_(2023).pdf
- [17] Atmosfera Marsa: https://en.wikipedia.org/wiki/Atmosphere_of_Mars
- [18] Atmosfera Jowisza, sonda Galileo — gazy szlachetne (Wikipedia): https://en.wikipedia.org/wiki/Atmosphere_of_Jupiter
- [19] Ochrona ISS przed meteoroidami (National Academies): https://www.nationalacademies.org/read/5532/chapter/6
- [20] Nextel na ISS: https://ceramics.org/ceramic-tech-today/nextel-ceramic-fabric-stars-in-recent-international-space-station-walk/ ; ESA, nowe koncepcje osłon: https://conference.sdo.esoc.esa.int/proceedings/sdc4/paper/59/SDC4-paper59.pdf ; NASA 2025 (bazalt zamiast Nextelu): https://ntrs.nasa.gov/api/citations/20250001790/downloads/Cline_Basalt_EuropeanODConf_2025_V2.pdf
- [21] Węglik boru (przegląd, Wikipedia): https://en.wikipedia.org/wiki/Boron_carbide
- [22] Meteoryty żelazne — klasyfikacja Ga / Ge / Ir (Wikipedia): https://en.wikipedia.org/wiki/Iron_meteorite
- [23] Atmosfera Tytana (Wikipedia): https://en.wikipedia.org/wiki/Atmosphere_of_Titan
- [24] Psyche, metal mniejszy niż sądzono (~82,5% metalu): https://iopscience.iop.org/article/10.3847/PSJ/abf63b/meta ; Brown University: https://www.brown.edu/news/2022-02-14/psyche
- [25] Skład powierzchni Merkurego z MESSENGER: https://arxiv.org/pdf/1712.02187 ; Nittler i in.: https://repository.si.edu/items/ff17dc88-d52f-4f89-8a36-028d9ddca749
- [26] Wtrącenia CAI (Wikipedia): https://en.wikipedia.org/wiki/Calcium%E2%80%93aluminium-rich_inclusion
- [27] Lunar Resources: A Review (ilmenit, anortyt, tlen): https://arxiv.org/pdf/1410.6865 ; glin z anortytu (NSS / NASA SP): https://nss.org/settlement/nasa/spaceres/V-4.html
- [28] Meteoryty HED (Westa) (Wikipedia): https://en.wikipedia.org/wiki/HED_meteorite
- [29] KREEP: https://en.wikipedia.org/wiki/KREEP ; The Planetary Society: https://www.planetary.org/articles/3013
- [30] Beck i in. 2021 — woda planetoid C (~4,5% wag.): https://sshade.eu/data/publication/PUBLI_Beck_2021 ; chondryty CI / CM: https://en.wikipedia.org/wiki/Carbonaceous_chondrite

Bez linku, jako wiedza ogólna: amoniak w zewnętrznych pętlach chłodzenia ISS, reakcja Sabatiera na stacji, skład taśmy REBCO (podłoże Hastelloy), materiały wybuchowe i miotające na bazie azotu.

---

## 3. Wariant A — „realistyczny pełny” (referencja)

To nie jest propozycja do wdrożenia: przy ok. 90 pozycjach i dzisiejszym ruchu v2 (magazyn i zlecenia per towar, licytacja stoczni) tick i bilans by się rozsypały. Służy za wzorzec, z którego wariant B bierze tylko to, co tworzy trasy.

### 3.1 Surowce (≈30)

| grupa | surowce |
|---|---|
| metal M / S | żelazo-nikiel (z Co), platynowce, złoto i srebro, gal i german (w metalu), metale ogniotrwałe W/Mo/Re |
| skały | krzemiany (Si, Mg), ilmenit (Ti, Fe), anortyt (Al, Ca), KREEP (ziemie rzadkie, Th, U, P, K), siarczki (S, Cu), sole i węglany (Na, Cl), borany (B), solanki litowe (Li) |
| lotne | lód (H₂O z D), CO₂, N₂, NH₃, CH₄, He-3, H₂, Ar, Kr / Xe, toliny |
| rozszczepialne | uran, tor |
| odzysk | złom konstrukcyjny, złom elektroniczny |

### 3.2 Rafinaty (≈35)

- **Metale:** stal konstrukcyjna, stal działowa, nadstop Ni, nadstop Co, stop Ti-6Al-4V (Ti + Al + V), stop Al i Al-Li, miedź katodowa i przewód, srebro, wolfram spiekany, W-Re, niob C-103.
- **Elektronika:** krzem półprzewodnikowy, płytki GaN / GaAs, german, tlenki ziem rzadkich, taśma REBCO, magnesy NdFeB.
- **Optyka:** szafir, YAG:Yb i włókno Yb, szkło kwarcowe.
- **Ceramika i kompozyty:** B₄C / SiC / Al₂O₃, włókno węglowe i CFRP, C/C-SiC, aramid / UHMWPE, tkanina Nextel.
- **Lotne i paliwa:** tlen, wodór, deuter, He-3, granulki D–He-3, paliwo UO₂ / TRISO, Li-6.
- **Chemia:** materiał wybuchowy HMX / CL-20, proch (NC), paliwo stałe (AP + Al + HTPB), chłodziwo (NH₃, NaK), polimery (PE, poliimid), elektrolit litowy.

### 3.3 Podzespoły (≈22)

cewka nadprzewodząca · kriochłodziarka · bank kondensatorów · zasilacz impulsowy · radiator · moduł obliczeniowy · radar AESA (GaN) · głowica podczerwieni (Ge, InSb) · moduł lasera światłowodowego · zwierciadło i okno optyczne · dysza magnetyczna · komora fuzyjna (ściana W + płaszcz) · osłona neutronowa · panel pancerza (Whipple + ceramika) · belka konstrukcyjna · obrotnica wieży · aktuator i silnik elektryczny · zbiornik kriogeniczny · bateria / superkondensator · elektrolizer i reaktor Sabatiera · zapalnik zbliżeniowy · łuska i ładunek miotający

### 3.4 Produkty (skład w wariancie A)

| produkt | główny skład |
|---|---|
| działo kinetyczne | stal działowa, obrotnica, aktuatory (NdFeB), moduł obliczeniowy; amunicja: penetrator W lub stal + proch + zapalnik |
| działo szynowe | szyny Cu-Cr / Cu-W z powłoką W, obudowa z nadstopu i CFRP, bank kondensatorów (PP + Al), przełączniki SiC, radiator; pocisk W + armatura Al |
| laser | moduły włókna Yb, diody GaAs, zwierciadło SiC, okno szafirowe, radiator, moduł obliczeniowy |
| plazma | cewki nadprzewodzące, komora W / C-C, zasilacz impulsowy, elektrody Ir / Re; gaz roboczy D lub Ar |
| wyrzutnia rakiet | rury Al / stal, aktuatory; rakieta: kadłub CFRP, paliwo stałe AP-Al, głowica IR (Ge), HMX |
| torpeda | jak rakieta, a w klasie kapitałowej głowica jądrowa (U / D-T) |
| CIWS / flak | działo kinetyczne + radar AESA, pociski z zapalnikiem zbliżeniowym |
| reaktor fuzyjny | cewki REBCO, kriochłodziarka, komora W, osłona (woda, B₄C, stal), radiatory, rozruch z prętów U |
| napęd MAIN / hipercruise | dysza magnetyczna (REBCO), komora W, nadstop Ni i niob, zbiorniki H₂ |
| SIDE | silniki Halla (BN, magnesy, Ar / Kr) albo metalox (nadstop) |
| warp (fikcja) | dużo cewek nadprzewodzących, reaktor, moduły obliczeniowe, platynowce |
| tarcza (fikcja) | cewki nadprzewodzące, banki kondensatorów, radiatory |
| kadłub | belki stal / Ti, poszycie Al / CFRP, osłona Whipple (Al + Nextel + aramid), na okrętach ceramika B₄C / SiC |
| LSS | elektrolizer, Sabatier (Ni / Ru), filtry węglowe, zbiorniki wody i N₂ |
| myśliwiec | płatowiec Al-Li / Ti / CFRP, awionika, mały napęd, baterie |

---

## 4. Wariant B — „grywalny skrót” (propozycja do wdrożenia)

Zasady:
1. **Wszystkie obecne klucze zostają.** Protokół workera i testy liczą po `RESOURCE_KEYS`, więc nowe klucze idą NA KONIEC grup (raport E8: wstawienie w środek przesuwa indeksy).
2. **Nowa pozycja wchodzi tylko wtedy, gdy tworzy trasę,** czyli miejsce A ma ją, a B potrzebuje. Inaczej zostaje etykietą w istniejącym kluczu.
3. **Model wartości bez zmian:** wyjście ≈ wejście × 1,6 (rafinacja) albo × 1,5 (montaż).
4. **Ograniczenia zostają:** Ziemia nic nie wydobywa, księżyc daje surowiec a planeta przerabia, amunicja tylko z rafinatów.

### 4.1 Co dochodzi

| klucz | poziom | nazwa | receptura (propozycja) | cena CR (szac.) | producent | po co |
|---|---|---|---|---|---|---|
| `rare_earth_ore` | T0 | Ziemie rzadkie (KREEP) | — | 30 | Luna (główne), Mars (małe) | magnesy nadprzewodzące |
| `aluminum_ore` | T0 | Ruda glinu (anortyt) | — | 8 | Luna, Westa | lekka konstrukcja, kondensatory, ceramika |
| `superconductor` | T1 | Taśma nadprzewodząca | 1 ziemia rzadka + 2 przewód + 1 nadstop Ni → 2 (70 s, elektronika) | ~86 | Wenus, Ziemia, Mars, Ceres | reaktor, napęd ciężki, hipercruise Mk2–3, warp, tarcza, plazma |
| `aluminum` | T1 | Stop glinu | 3 rudy glinu → 2 (40 s, huta) | ~19 | każda huta z rudą | płyty, stop Ti, myśliwce, railgun |
| `ceramic_armor` | T1 | Ceramika pancerna | 2 rudy glinu + 1 ruda węglista → 1 (50 s, huta) | ~38 | Westa, Ceres, Ziemia, Mars | pancerz okrętów wojennych |
| `explosive` | T1 | Materiał wybuchowy | 2 amoniak + 1 metan → 2 (40 s, gazownia) | ~20 | Jowisz, Saturn, Uran | cała amunicja |
| `shield_generator` | T2 | Emiter tarczy | 3 nadprzewodnik + 1 stop Al + 1 polimer + 1 awionika + 2 chłodziwo → 1 (150 s, systemy) | ~1080 | Ziemia, Mars, Jowisz, Ceres | tarcze okrętów |

Bilans pozycji: 52 → 59 (z `warp_mk1..3` od E8: 62). Klucz `ceramic_armor` ma wsad z dwóch rud, bo realnie korund i węglik robi się z rudy i węgla, a nie z gotowego stopu.

### 4.2 Co się zmienia w obecnych recepturach

| receptura | dziś | propozycja | dlaczego |
|---|---|---|---|
| `etch_chips` | 4 Si → 1 IC | 6 Si + 1 Ni → 2 IC (70 s) | krzem przestaje być jedynym gardłem (−25% Si na układ); Ga / Ge z metalu M wiąże elektronikę z pasem; dłuższy czas oddaje to, że gardłem jest fabryka |
| `alloy_titanium` | 4 Ti + 1 stal → 2 | 4 Ti + 1 stop Al → 2 | Ti-6Al-4V; zdejmuje stal (żelazo) i kładzie glin |
| `fusion_fuel` | 2 He-3 + 1 H₂ | bez zmian; etykieta „H₂ / D₂” | deuter z wody (komety, Kuiper) |
| `assemble_hull_plate` | 4 stal + 1 TiA | 3 stal + 1 stop Al + 1 TiA | poszycie Whipple'a z glinu |
| `assemble_reactor_core` | 2 pręty + 2 TiA + 1 chł. | 2 nadprzewodnik + 1 pręt + 1 TiA + 1 ceramika + 1 chł. | fuzja D–He-3 jako główny reaktor, pręt na rozruch i zapas; **popyt na uran −50%** |
| `assemble_drive_heavy` | 10 NiA + 2 płyty + 4 CFK + 3 chł. + 4 Cu | 7 NiA + 2 nadprzewodnik + 2 płyty + 4 CFK + 3 chł. + 2 Cu | dysza magnetyczna |
| `assemble_hypercruise_mk2` | 8 NiA + 6 CFK + 2 Kat + 1 awion. + 3 chł. | + 1 nadprzewodnik, −2 NiA | jw. |
| `assemble_hypercruise_mk3` | 12 NiA + 8 CFK + 4 Kat + 1 rdzeń + 1 awion. + 4 chł. | + 3 nadprzewodnik, −3 NiA | jw. |
| `assemble_thruster` | 2 płyty + 1 chł. + 2 Cu | 1 płyta + 2 NiA + 1 chł. + 2 Cu | dysze RCS z nadstopu, nie z płyty pancernej |
| `assemble_gun_railgun` | 3 NiA + 5 Cu + 1 TiA + 2 stal | 2 NiA + 4 Cu + 2 stop Al + 1 polimer + 2 stal | szyny Cu, kondensatory foliowe (Al + polimer), obudowa z nadstopu |
| `assemble_gun_plasma` | 1 Kat + 3 NiA + 3 chł. + 4 Cu + 1 opt. | 1 Kat + 1 nadprzewodnik + 3 NiA + 3 chł. + 2 Cu + 1 opt. | cewki; katalizator jako elektrody z platynowców |
| `assemble_fighter_craft` | 2 TiA + 1 IC + 1 opt. + 4 Cu + 2 polimer | 1 TiA + 2 stop Al + 1 IC + 1 opt. + 3 Cu + 2 polimer | płatowiec Al-Ti |
| `assemble_ammo_kinetic` | 2 stal + 1 polimer → 6 | 2 stal + 1 materiał wybuchowy → 6 | ładunek miotający |
| `assemble_flak_shell` | 1 stal + 1 IC + 1 polimer → 4 | 1 stal + 1 IC + 1 MW → 4 | jw. |
| `assemble_missile_round` | … 2 polimer … | … 1 polimer + 1 MW … | paliwo stałe i głowica |
| `assemble_torpedo_round` | … 3 polimer … | … 1 polimer + 2 MW … | jw. |
| `warp_mk1..3` (E8) | w pracy | Mk1: 4 nadprzewodnik + 1 rdzeń + 2 awion. + 1 Kat; Mk2: 8 / 2 / 3 / 2; Mk3: 14 / 3 / 4 / 4 | kontrakt id z E8; warp jako najdroższy moduł „pola i mocy” |

**Etykiety bez zmiany klucza:**
- `raw_crystal` → „Minerały optyczne” (korund, kwarc, beryl);
- `platinum_ore` → „Platynowce” (bez zmian);
- `copper_ore` zostaje, ale z adnotacją w danych, że to fikcja dla Wenus (§ 7, decyzja 6).

**Składy okrętów** (pancerz i tarcza tylko na okrętach wojennych):

| klasa | + `ceramic_armor` | + `shield_generator` |
|---|---|---|
| fregata | 2 | 1 |
| niszczyciel | 6 | 1 |
| krążownik | 16 | 2 |
| nosiciel | 24 | 3 |

Frachtowce bez pancerza i tarczy (`FREIGHTER_BUILD` bez zmian).

### 4.3 Mapowanie na obecne klucze

| | klucze |
|---|---|
| **zostaje bez zmian** | `iron_ore`, `silicon_ore`, `titanium_ore`, `ice`, `uranium_ore`, `carbon_ore`, `nickel_ore`, `platinum_ore`, `helium3`, `methane`, `ammonia`, `scrap`, `steel`, `copper_wire`, `optic_lens`, `hydrogen`, `oxygen`, `fuel_rods`, `polymer`, `coolant`, `fusion_fuel`, `nickel_superalloy`, `carbon_composite`, `pt_catalyst`, `avionics`, `weapon_mount`, `life_support`, `drive_light`, `gun_ballistic`, `gun_energy`, `launcher_ordnance`, `launcher_torpedo`, `pd_turret`, `flak_turret`, `hypercruise_mk1` |
| **zmienia recepturę** | `chips`, `titan_alloy`, `hull_plate`, `reactor_core`, `thruster`, `drive_heavy`, `hypercruise_mk2`, `hypercruise_mk3`, `gun_railgun`, `gun_plasma`, `fighter_craft`, cztery amunicje |
| **zmienia etykietę** | `raw_crystal`, `copper_ore` (opis) |
| **dochodzi** | `rare_earth_ore`, `aluminum_ore`, `superconductor`, `aluminum`, `ceramic_armor`, `explosive`, `shield_generator` |
| **usuwa się** | nic |

**Archetypy (`INDUSTRY_ARCHETYPES`), tylko dopisane receptury, struktura bez zmian:**
- `foundry` + `smelt_aluminum`, `sinter_ceramic_armor`;
- `electronics` + `tape_superconductor`;
- `gasworks` + `synth_explosive`;
- `systems` + `assemble_shield_generator`.

Do tego `FLEET_DEMAND` + `ceramic_armor`, `shield_generator` (te same proporcje doktryny), `SALVAGE_COMPONENTS` + `superconductor` (z dużych wraków), opcjonalnie `MILITARY_UPKEEP` + `fusion_fuel` (paliwo floty).

**`PLANET_YIELD` (minimum):**
- **Luna:** nowy wpis kopalni, `rate` ~0,6: ziemie rzadkie 0,35, ruda glinu 0,40, tytan 0,25; `SYSTEM_INDUSTRY_SPEC` bez zmian (`capacity` 0, księżyc nie przerabia);
- **Mars:** + ziemie rzadkie ~0,05;
- **Westa:** + ruda glinu ~0,15 (`rate` w górę tak, żeby inne rudy zostały w tych samych tonach, jak przy E8);
- reszta bez zmian.

**Pas:** bez nowych typów skał (wygląd i `ROCK_TYPES` bez zmian). Opcjonalnie glin z pól S jako produkt uboczny, gdy włączy się `minWanted` < 1 (E3).

### 4.4 Geografia i trasy

Kto co ma, kto czego potrzebuje (wariant B):

| miejsce | wydobywa | przerabia | potrzebuje z zewnątrz (nowe pogrubione) |
|---|---|---|---|
| **Luna** (TN) | **ziemie rzadkie, glin, Ti** | — | byt |
| Ziemia (TN) | — | huta, elektronika (**nadprzewodnik**), stocznia, systemy (**tarcza**), zbrojownia | wszystkie rudy; **ziemie rzadkie i glin z Luny** (bez amunicjowni, więc bez MW) |
| Mars (SM) | Fe, Si, lód, kryształ, **trochę ziem rzadkich** | jak Ziemia + przetop złomu | **glin**, **ceramika**, nadstop, kompozyt |
| Wenus (KW) | Cu, Si, kryształ | huta, elektronika (**nadprzewodnik**), amunicjownia | **ziemie rzadkie z Luny**, **MW z olbrzymów** (zamiast polimeru), **Ni do układów** |
| Merkury (KW) | Fe, Ti, Si, Cu | huta | **glin** do stopu Ti |
| Ceres (UP) | Fe, Si, lód, kryształ, C | rafineria pasa, huta (**ceramika**), elektronika, stocznia, systemy | **ziemie rzadkie**, **glin z Westy** |
| Westa (UP) | Fe, Ti, Si, Ni, Pt, **glin** | huta (**stop Al, ceramika**), rafineria pasa | węgiel z Ceres i pasa do ceramiki |
| Jowisz (KZ) | gazy, lód | gazownia (**MW**), lotne, stocznia, systemy | **nadprzewodnik** (nie ma elektroniki), **ceramika**, metale |
| Saturn, Uran (KZ) | gazy | gazownia (**MW**), wzbogacalnia (popyt na pręty −50%), amunicjownia (Saturn) | stal, układy |

Nowe trasy:
1. **Luna → Ziemia / Wenus / Mars / Ceres:** ziemie rzadkie. Krótka trasa w rdzeniu (Luna → Ziemia, minuty) i długa do pasa.
2. **Wenus / Ziemia / Mars → Jowisz:** taśma nadprzewodząca. Jowisz buduje okręty, a nie robi elektroniki, więc to nowa długa trasa rdzeń → olbrzymy, obok obecnej trasy metali.
3. **Westa ↔ Ceres:** glin i węgiel na ceramikę (lokalny ruch Unii Pasa).
4. **Westa / Luna → Merkury, Ziemia, Mars:** glin do stopu Ti i płyt.
5. **Olbrzymy → Wenus:** materiał wybuchowy na amunicję (zastępuje część polimeru, ten sam kierunek).
6. **Pas (M) → huty elektroniki:** ruda niklu jako źródło Ga / Ge do układów. Popyt na nikiel poza Westą.
7. **Rdzeń i Unia → wszystkie stocznie:** ceramika i emitery tarcz przez kupców (mechanizm E4: stocznia bez podzespołów płaci więcej).
8. **Wraki → Mars:** odzysk nadprzewodnika z holowanych wraków; drugie, wojenne źródło ziem rzadkich.

Polityka, która z tego wynika (do fabuły, bez kodu): Terra Nova ma Lunę, czyli monopol na magnesy. Unia Pasa ma glin i ceramikę (pancerz), Konsorcjum Zewnętrzne ma hel-3 i materiał wybuchowy, a piraci żyją z przechwytów na trasie 2 (nadprzewodnik do Jowisza).

### 4.5 Konsumpcja

- **Stocznie (budowa):** pancerz i tarcza dochodzą tylko na okrętach wojennych. Rdzeń reaktora zjada nadprzewodnik, a napęd ciężki i hipercruise Mk2–3 też. Na fregatę dochodzi ok. 2 ceramiki + 1 emiter (~1150 CR, +25% wobec 4540 CR); na nosiciel 24 ceramiki + 3 emitery + nadprzewodnik w 7 rdzeniach. Przelicz `node scripts/koszt-okretow.mjs`: koszt ma dalej rosnąć szybciej niż siła (`FLEET_DOCTRINE`).
- **Utrzymanie (`FLEET_DEMAND`):** ceramika ~0,03 i emitery ~0,01 na cykl, tą samą metodą co płyty. Opcjonalnie paliwo fuzyjne floty (realny pobór reaktorów): `MILITARY_UPKEEP` + `fusion_fuel` ~0,02 jako stały ciąg z olbrzymów do portów wojennych.
- **Straty wojenne (`warDispatcher`):** straty i holowanie czytają `WARSHIP_CLASSES.build`, więc nowe towary wejdą same. Wraki holowane oddają nadprzewodnik (`SALVAGE_COMPONENTS`), a cięte w polu tylko złom.
- **Amunicja:** materiał wybuchowy w każdej amunicji. Wojna podnosi popyt na amoniak i metan, czyli ruch od olbrzymów i Tytana do amunicjowni (Wenus, Saturn). Laser i railgun nie jedzą MW; slug railgunu to dalej stal (`ammo_kinetic`), a laser zużywa tylko moc.
- **Byt:** bez zmian (tlen, paliwo fuzyjne, LSS).

---

## 5. Ryzyka dla bilansu gospodarki

1. **Ziemie rzadkie z jednego miejsca.** Luna daje ~90%, więc blokada Luny zatrzymuje reaktory całego układu.
   - Zabezpieczenia: Mars jako drugie źródło (~0,05) i odzysk z wraków. Nadprzewodnik powinien mieć zapas startowy jak lufy (45%).
   - Do zmierzenia: głód `rare_earth_ore` i `superconductor` przy blokadzie Luny (scenariusz z presją piratów ×2).
2. **Uran z jednego regionu (Kuiper).** Wariant B zmniejsza popyt na pręty o połowę, ale źródło zostaje jedno. Dziś to jedyny głód po fali 1 (Saturn U 75–83 min). Opcje w § 7, decyzja 3.
3. **Krzem.** Zmiana `etch_chips` zdejmuje ~25% popytu na Si, ale kładzie nikiel na elektronikę. Nikiel już głodował na Ceres (~34 min, notatka E3), a dyspozytor wysyła wyprawy tylko po to, czego nikt nie ma na zbyciu.
   - Do zmierzenia: pokrycie Si i Ni (sekcja bilansu `scripts/tests/stationEconomy.test.mjs`) i głód `nickel_ore` na Ceres i Westie.
4. **Żelazo i stal w dół, glin w górę.** Płyta zjada mniej stali, a stop Ti nie zjada jej wcale. Huty Merkurego i Ziemi skalibrowano pod te liczby (komentarz przy `PLANET_YIELD`), więc mogą powstać nadwyżki Fe, które zapchają redy.
   - Do zmierzenia: kolejka na redzie i zapełnienie magazynów Fe / stali.
5. **Produkty uboczne bez popytu.** E3 już raz złapało redę Saturna (urobek przy okazji). Nowa ruda w `PLANET_YIELD` bez popytu tak samo zapcha magazyn, więc glin i ziemie rzadkie wchodzą RAZEM z recepturami, nigdy osobno.
6. **Podzespoły nie jeżdżą między stacjami** (odkrycie E8). Emiter tarczy i nadprzewodnik muszą powstawać tam, gdzie się je zużywa, albo jeździć jako T1. Dlatego nadprzewodnik jest T1 (towar, który jeździ), a emiter powstaje w `systems` na każdej stoczni z tą rolą. Stocznie bez `systems` (Merkury, Wenus, Saturn, Uran, Westa) dostaną go tylko przez kupców E4. Do sprawdzenia: najdłuższy postój pochylni po zmianie.
7. **Koszt ticku.** +7 towarów to więcej ofert i zleceń. Tick po E4 to 22–24 ms przy progu 25 ms, czyli mało zapasu. Do zmierzenia w tej samej bitwie A/B (naprzemiennie, ziarno 11), a nie samym szczytem.
8. **Indeksy `RESOURCE_KEYS`.** Nowe klucze na KONIEC każdej grupy, a testy migawek (`stationEconomy` 2a) przestawić świadomie.
9. **Ceny w kaskadzie.**
   - Rdzeń reaktora prawie nie drożeje (~740 → ~700 CR): dwa nadprzewodniki zastępują pręt i stop Ti. Napęd ciężki i hipercruise Mk2 rosną o kilka procent.
   - Kaskada siedzi w warpie: Mk3 to 14 nadprzewodników (~1200 CR) plus 3 rdzenie, a nadprzewodnik zależy od Luny.
   - Emiter tarczy podnosi koszt fregaty o ~25%.
   - Sprawdzić, czy stocznia z przyduszeniem ×2,6 nie wpada w spiralę cen (E4).

### Co zmierzyć bramką

Każdy etap wdrożenia przechodzi bramkę A/B: baza `main` i zmiana, przebiegi PO KOLEI.

```bash
node scripts/bramka-bilansu.mjs --etykieta e10-baza --ziarna 7,11,23 --minuty 240
```

```bash
node scripts/bramka-bilansu.mjs --etykieta e10-wariantB --ziarna 7,11,23 --minuty 240
```

Progi z planu § 5 i to, czego pilnować przy tej zmianie:

| próg | czego pilnować |
|---|---|
| głód > 30 min | lista per klucz, zwłaszcza `rare_earth_ore`, `superconductor`, `aluminum`, `ceramic_armor`, `explosive`, `nickel_ore` (Ceres, Westa), `uranium_ore` (Saturn) |
| stocznia bez pochylni > 30 min | Merkury, Wenus, Saturn, Uran, Westa (bez `systems`) |
| kolejka na redzie ≤ 2 | Luna (nowy port wydobywczy przy K-7) i Saturn |
| tick ≤ 25 ms | A/B naprzemiennie na jednym ziarnie |
| przechwyty 12–20% | trasa nadprzewodnika do Jowisza ma być celem piratów, ale nie dusić stoczni |

Dodatkowe liczby, które warto dopisać do raportu bramki (propozycja dla E4):
- liczba zleceń per nowy towar > 0, czyli czy trasa w ogóle powstała;
- statyczna lista „towar z jednym producentem lub jednym źródłem rudy” liczona z tabel;
- pokrycie popytu podażą per T0 w stanie ustalonym (dziś liczy je test `stationEconomy`).

Dla okrętów dodatkowo `node scripts/koszt-okretow.mjs` (CR na punkt siły ma rosnąć z klasą).

---

## 6. Proponowana kolejność wdrożenia (gdy użytkownik zaakceptuje)

Każdy krok osobno przez bramkę:

1. **Amunicja na materiale wybuchowym** (`explosive` + cztery receptury). Najmniejsza zmiana i od razu nowa trasa olbrzymy → Wenus.
2. **Glin i ceramika:** `aluminum_ore` (Westa, potem Luna), `aluminum`, `ceramic_armor`, płyta, stop Ti, myśliwiec, pancerz okrętów.
3. **Ziemie rzadkie i nadprzewodnik:** Luna jako kopalnia, `superconductor`, rdzeń reaktora (−50% uranu), napędy, plazma, odzysk z wraków.
4. **Tarcza:** `shield_generator` w składach okrętów.
5. **Elektronika:** `etch_chips` z niklem (osobno, bo rusza najciaśniejsze surowce).
6. **Warp Mk1–3** na nadprzewodniku (razem z E8).
7. Opcjonalnie, decyzja 6: realizm planet (Merkury bez żelaza, Wenus atmosferyczna).

---

## 7. Decyzje dla użytkownika

1. **Wariant B w całości czy częściowo?** Siedem nowych pozycji to propozycja; minimalny sensowny zestaw to `explosive` + `superconductor` + `rare_earth_ore` (trzy nowe trasy).
2. **Luna jako kopalnia** (ziemie rzadkie, glin, tytan)? Zgodne z realizmem i z zasadą „Ziemia nic nie wydobywa”, ale Terra Nova zyskuje monopol na magnesy (polityka frakcji).
3. **Uran.** Do wyboru:
   - (a) zostaje tylko w Kuiperze, popyt −50% przez reaktor fuzyjny (rekomendacja: zachowuje decyzję i sens wypraw);
   - (b) dochodzi Luna (KREEP) jako drugie źródło — realizm, ale łamie decyzję „uran tylko w Kuiperze”;
   - (c) pręty tylko na torpedy / głowice.
4. **Reaktor okrętu: fuzja D–He-3 jako główny** (pręty na rozruch)? Rekomendacja: tak.
5. **Krzem.** Czy przestaje być najciaśniejszym surowcem (układy z Ga / Ge z niklu)? Realistycznie tak, ale to zmiana kalibracji całego rdzenia.
6. **Realizm planet:**
   - Merkury ma realnie ubogą w żelazo powierzchnię (Mg, S, Si; huta słoneczna);
   - Wenus nie nadaje się na kopalnię (atmosfera: CO₂, N₂, siarka; stacja w chmurach);
   - zostawiamy jako fikcję gry czy przestrajamy w osobnym kroku (duża zmiana bilansu)?
7. **Tarcze jako towar** (`shield_generator`) — wchodzą do gospodarki czy zostają poza nią?
8. **Warp:** kotwica „nadprzewodnik + rdzeń + platynowce” (najdroższy moduł) — zgoda na kontrakt z E8?
9. **Rzeczy pominięte w B** (lit, bor, wolfram, ksenon, azot i fosfor do żywności, argon na SIDE): zostają tylko w wariancie A czy któraś ma wejść (np. argon z Marsa na silniki manewrowe, azot z Tytana do LSS)?

---

## 8. Wdrożenie (2026-10-22)

Użytkownik przyjął wariant grywalny w całości (§ 7: 1–9) i dołożył fregatę z warpem Mk I. Wdrożenie szło krokami z § 6, każdy przez bramkę bilansu. Gałąź `claude/e10-receptury-realne-a8c587`.

### 8.1 Co weszło, a co różni się od propozycji

| towar | poziom | receptura (wsad → wyjście) | cena CR | skąd | różnica wobec § 4 |
|---|---|---|---|---|---|
| `explosive` | T1 | 2 amoniak + 1 metan → 2 (40 s, gazownia) | 20 | Jowisz, Saturn, Uran | — |
| `aluminum_ore` | T0 | — | 8 | Luna (49%), Westa (18%), Ceres (8%) | Ceres dodatkowo (kolejka Ceres) |
| `aluminum` | T1 | 3 rudy glinu → 2 (45 s, huta) | 19 | każda huta | — |
| `ceramic_armor` | T1 | 2 rudy glinu + 1 ruda węglista → 1 (50 s, huta) | 37 | każda huta | — |
| `rare_earth_ore` | T0 | — | 30 | Luna (20%, ~90% podaży), Mars (2%), wraki | Mars mniejszy (monopol Terra Novej) |
| `superconductor` | T1 | 1 REE + 1 przewód + 1 nadstop → 2 (70 s, elektronika) | 75 | Wenus, Ziemia, Mars, Ceres | 1 przewód zamiast 2 (ruda miedzi spadła do 99%) |
| `shield_generator` | T2 | 3 taśmy + 2 stop glinu + polimer + układ + 2 chłodziwo → 1 (150 s, systemy) | 620 | Ziemia, Mars, Jowisz, Ceres | bez awioniki, 620 zamiast ~1080 CR; 1 / 3 / 6 / 9 na klasę zamiast 1 / 1 / 2 / 3 |
| `nitrogen` | T0 | — | 5 | Tytan (6%), Tryton (5%) | nowy (decyzja 9: azot z Tytana) |

Zmienione receptury (jak w § 4.2, z tymi wyjątkami):
- **Płyta kadłuba:** 4 stal + 1 stop glinu + 1 stop Ti. Stal zostaje w całości, bo przy 3 stali pokrycie żelaza skakało do 186% (huty skalibrowane pod stal).
- **Silnik manewrowy:** 1 płyta + 3 nadstop + 1 chłodziwo + 3 przewód.
- **Podtrzymanie życia:** dochodzi 1 azot.
- **Warp:**
  - Mk I: 4 taśmy + 2 nadstop + 2 stop Ti + 2 chłodziwo (870 CR), bez platynowców i rdzenia, bo ma go każda fregata;
  - Mk II: 8 taśm + rdzeń + 2 awionika + 2 katalizatory + 4 nadstop + 3 chłodziwo (4000 CR);
  - Mk III: 14 taśm + 2 rdzenie + 3 awionika + 4 katalizatory + 6 nadstop + 5 chłodziwo (7000 CR).
- **Reszta jak w § 4.2:** stop Ti z glinem, reaktor (2 taśmy + 1 pręt + stop Ti + ceramika + chłodziwo), napęd ciężki, hipercruise Mk2/Mk3, działo szynowe, działo plazmowe, myśliwiec, cztery amunicje, układy scalone (6 Si + 1 Ni → 2).
- **Okręty wojenne:** ceramika 2 / 6 / 16 / 24, emitery 1 / 3 / 6 / 9, fregata z `warp_mk1`. `FLEET_DEMAND`: ceramika 0,035, emitery 0,0151, `warp_mk1` 0,0088. Wraki oddają taśmę (`SALVAGE_COMPONENTS`, co 900 komórek). Luna ma w `systemMap.js` rolę `mine`.

Razem 52 → 63 towary (z `warp_mk1..3` od E8 i azotem), 46 receptur.

### 8.2 Bilans analityczny (sekcja 12 testu `stationEconomy`, na cykl)

| surowiec | przed | po |
|---|---|---|
| ruda uranu (popyt) | 2,40 | 1,15 (−52%) |
| ruda krzemu | 130% | 191% |
| platynowce | 101% | 131% |
| ruda żelaza | 136% | 171% |
| ruda niklu | 131% | 111% |
| ruda miedzi | 137% | 120% |
| ruda glinu | — | 129% |
| ziemie rzadkie | — | 160% |
| taśma nadprzewodząca | — | 132% |

Najciaśniejsze rafinaty trzymają 106–108% jak przedtem (solver).

Koszt na punkt siły (`scripts/koszt-okretow.mjs`): fregata 6104, niszczyciel 6424, krążownik 7276, nosiciel 9105 CR. Przedtem 4540 / 5894 / 6405 / 8337 CR.
