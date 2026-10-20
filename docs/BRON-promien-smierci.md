# Promień Śmierci „Gungnir” (`death_ray`) — wbudowana wieża Colossusa Terra Nova

2026-10-19, prośba użytkownika: „brakuje ogromnego lasera, który ma Venator — może trzeba dodać broń death ray: na strzała
niszczy battleship”. Broń ma posłużyć scenie „Wojna” (prawdziwe encje na płaszczyźnie gry + czysto wizualny strzał w
warstwach bitwy w głębi).

## Zmiana 2026-10-20: wbudowana wieża Colossusa, tylko NPC, jeden cel

User: „built in turret single target — daj go supercapitalovi terran … broń jest zbyt potężna na special slot”.

- **Wieża wbudowana Colossusa.** `mountType: 'builtin'` z wieżą (`builtinTurret` — Turret2D rysuje wieżę na gnieździe
  builtin tylko z tym polem; Hexlance dalej lufą w kadłubie) na gnieździe builtin supercapitala Terra Nova
  (`terran_supercapital`: punkt edytora x 813, y 0, `rot` 90 — dziób; `spec.builtin: 1`,
  `defaultNpcLoadout: { builtin: 'death_ray' }`).
- **Tylko NPC i tylko Terra Nova.** `npcOnly`: `playerFitFits` odrzuca (WYPOSAŻENIE, plan fitowania, automat kart),
  zapis wyposażenia czyta wpis jako pusty, magazyn z zapisu go nie zna, `weaponBuildCost` → null (bez ceny, katalogu,
  sklepu), `DevScene.mountSpecial('death_ray')` → 0. `npcFaction: 'terran'`: piracki „supercapital” bez własnej ramy
  rozwiązuje się do ramy Colossusa — `equipNpcWeapons` zostawia mu gniazdo puste.
- **Jeden cel.** `penetration: 1` + `deathRay.singleTarget`: promień kończy się tuż za wyjściem z przebitego okrętu
  (pas rzazu + 30 j.) i najdalej za obwiednią celu strzału (× 1,2 + 300 j.), więc okręt za celem zostaje cały, także
  gdy kadłub celu się wymknie; laser naprowadzający przy ładowaniu kończy się na celu AI (rekord `RAY_CHARGE`).
  Decyzja „przebij / zatrzymaj” zapada przy dojściu czoła do materiału (wcześniej — przy zaplanowaniu, w kolejności
  zbierania kandydatów), rzaz zaczyna się od wejścia minus pas (`cutAt`). Mechanizm wielu przebić zostaje dla broni bez
  `singleTarget`.
- **AI.** Grupa `builtin` w `autoWeapons` (tylko broń z `builtinTurret`): kurs z `rot` w stopniach edytora, łuk 270°,
  cele wyłącznie okręty kapitałowe i niszczyciele (fregaty i myśliwce pomijane — 45 s przeładowania), linia ognia z
  pasem wiązki (pas rzazu + 60 j.) — także gracz, którego nie ma w siatce AI. `getLeadAim` dla broni natychmiastowej
  (`baseSpeed: Infinity`) celował w NaN (−∞ / −∞) — teraz bez wyprzedzenia.
- **Model wieży z Blendera** (osobna sesja, `scripts/blender/deathRay.py`, `assets/weapons3d/deathRay[_lod1].glb`,
  rejestr GLB w trybie AUTO) scalony na tej gałęzi: na dziobie Colossusa z daleka LOD1 (zoom 0,35–1,4, 3,5 tys.
  trójkątów), z bliska LOD0 (zoom 1,8 i 3,2 oraz kamery 3D, 12,6 tys.); 0 pipeline'ów synchronicznych i 0 błędów
  w trybie off i worker (`node scripts/webgpu/wieza-promienia-gra.mjs [--warianty stary,blender] [--query
  renderWorker=1]`). Wieża stoi na samym czubku dziobu (gniazdo builtin z edytora: x 813 przy półdługości sprite'a
  836) — pierścień wystaje poza obrys nosa.

Wyniki — § „Wyniki 2026-10-20” niżej. Decyzje z 2026-10-19 (gniazdo special, dwa przebicia) są nieaktualne.

## Decyzje (2026-10-19)

- **(do 2026-10-20) Gniazdo special Capital, nie broń wbudowana.** Hexlance (`builtin`) ma jeden stan na grę (`superweaponState`) i strzela
  tylko z Atlasa gracza. Promień ma strzelać też z okrętów NPC (scena), więc idzie torem specjali: gracz montuje go w
  WYPOSAŻENIU / `DevScene.mountSpecial('death_ray')`, NPC dostaje go w `npc.weapons.special` (AI strzela sama:
  `autoWeapons`, ładowanie `stepNpcWeaponCharge`) albo strzela na rozkaz sceny.
- **Wiązka natychmiastowa z czołem, nie pocisk.** Czoło biegnie 30 000 j/s (12 km w 0,4 s) — rzaz rozkłada się na kroki
  fizyki (pancernik: 1–3 kroki), obraz rośnie razem z czołem gry.
- **Tarcza świadomie przepalana.** Pole blokującej tarczy pada do zera, gdy czoło dojdzie do obrysu (efekt trafienia
  klasy „special”), bez testu `isShieldBreachedAt` — inaczej pancernik z tarczą 7200 nie ginąłby od jednego strzału.
- **Obrażenia z drogi w materiale.** baseDamage 20 000 × min(1, droga / 200 j.), najmniej 15% (otarcie). Pancernik
  (12 000 HP) ginie od każdego przejścia przez kadłub (≥ 120 j. materiału); lotniskowiec (42 000) i superkapitał
  (85 000) przeżywają z wyciętym pasem.
- **(do 2026-10-20) Przebicia: 2 okręty.** Trzeci na linii zatrzymuje promień: krater (`endCrater` 90 j.) i 35% obrażeń. Wraki są cięte
  (z pędem), ale nie liczą się do przebić. Stacja kończy promień (30 000 obrażeń raz).
- **Zasięg 12 km**: superbroń natychmiastowa krótsza niż Hexlance (15 km), dłuższa niż Valkyrie (9 km). Ładowanie 4 s
  (bez postoju — Venator strzela w ruchu), przeładowanie 45 s.
- **Barwa zielona** (`vfxColor: '#46ff8c'` — „superlaser”); jedna linia w danych. Scena może dać promieniowi inną barwę
  (`color: [r, g, b]`) — paleta cząstek idzie za nią.

## Rozgrywka (`src/game/deathRay.js`)

Promień = odcinek od wylotu w stałym kierunku świata; wylot jedzie z kadłubem strzelca (przesunięcie w jego układzie).
Krok fizyki (po `npcShootingStep`): stacje (koniec promienia), kandydaci w kolejności wejścia, pierwszy kontakt =
`HullBodies.traceThrough` po cięciwie PRZED rzazem (wejście, wyjście, droga — do 6 odcinków materiału), tarcza do zera
przy obrysie, `HullBodies.cutSegment(…, 55, { push: true })` na części kroku w materiale (źródło mapy ran: broń, `kerf`),
obrażenia przy wyjściu czoła przez `applyDamageToNPC(…, 'deathray', SHIELD_BREACH_DAMAGE_OPTS, byPlayer)` — śmierć, wrak
(`createWreckage`) i wybuch ze zbiornika paliwa jak przy każdej śmierci. Odcięte części to wraki z rozpadu silnika belek.

Haki: `window.DeathRayGame` (gra) i `?dev`: `DevScene.deathRay(strzelec, cel, opts)` (ładowanie przy gnieździe /
dziobie strzelca, strzał w AKTUALNĄ pozycję celu), `DevScene.deathRayVisual(x0, y0, x1, y1, opts)` (sam obraz: barwa,
szerokość, z0 / z1, ładowanie, rozbłysk końca), `DevScene.equipDeathRay(npc)`, `DevScene.deathRayState()`.

## Obraz (`src/3d/weapons/`)

Rekordy `RAY_FIRE / RAY_HIT / RAY_STATE / RAY_CHARGE` (render w workerze dostaje wszystko strumieniem rozkazów).
Wiązka: styl `BEAM.RAY` w jednym rysunku wiązek (bez nowego materiału — gałąź shadera; rozgrzewka siatki wiązek bez
zmian), wysokość z per wiązka (warstwy w głębi). Receptura `deathRay`: ładowanie (kula energii, iskry i łuki zbiegające
z pierścienia, fale implozji w DIST, laser naprowadzający od połowy ładowania), wylot, wejście / wyjście / tarcza /
zatrzymanie, żar w punktach trafień w trakcie wiązki, światła wzdłuż, fala wylotu i gorące powietrze
(`Core3D.fxDistortion()`). Wieża: sylwetka `SPECS.deathRay` + rodzina 3D `deathRay` (wylot 62 j. lokalnie).

Pasma HDR (po pierwszym przebiegu w grze — kadr zalany bloomem): jądro wiązki 3,0 (biel), środek ciała ~1 (przy progu
bloomu), ciało 0,4–0,9, poświata ~0,1; barwa broni × 1,3.

## Weryfikacja

- `tests/deathRay.test.mjs` — prawdziwy kadłub belek pancernika (sprite gry): jeden strzał przecina kadłub na wylot (pas
  ± 25 j. od osi pusty, odłam), obrażenia ≥ 12 000 → martwy i wrak; tarcza pada przed obrażeniami; dwa przebicia +
  zatrzymanie na trzecim; wrak bez przebicia; stacja; strzał wizualny (bez rzazu); rozkaz sceny; bez Math.random;
  wpięcie w index.html. Dekoder RAY_* — `tests/renderCommands.test.mjs`.
- W grze: `node scripts/webgpu/promien-gra.mjs [--query renderWorker=1]` — wyniki niżej.

### Wyniki `promien-gra.mjs` (2026-10-19, RTX, headless, 1600 × 900)

| Przypadek | Tryb off | Tryb worker |
|---|---|---|
| Atlas → piracki pancernik (tarcza 7200, 12 000 HP, 742 węzły) | martwy po 1 strzale (HP −8000), tarcza 0, 313 węzłów wyciętych, kadłub rozcięty na dwie połowy | to samo (HP −8000, tarcza 0, 313 węzłów) |
| Rozkaz sceny: pancernik TN → pancernik piracki | martwy (HP −8000) | martwy (HP −8000) |
| Strzał wizualny (barwa sceny) | wiązka i rozbłysk, bez trafień | wiązka i rozbłysk, bez trafień |
| Pipeline'y synchroniczne w fazach promienia (montaż i spawn, ładowanie, strzał, rozpad, rozkaz, wizualny) | 0 render / 0 compute | 0 (dziennik workera) |
| Błędy konsoli | 0 | 0 (strona i worker) |

Zrzuty: `.tmp/promien-off2/*.png`, `.tmp/promien-worker/*.png` (ładowanie, czoło, wiązka, rozpad, NPC, wizualny).
W workerze obraz czoła na zrzucie 04 bywa krótszy niż w `off` — bitmapa workera idzie kilka klatek za krokami
harnessu (stan gry ten sam).

Start gry w trybie worker (PRZED montażem promienia) — stan zastany: worker loguje 5 pipeline'ów synchronicznych spoza
promienia: `bridge3D:model / shadow / windows` (mostek Atlasa), `dysze SIDE 3D (partia)`, `wieże 3D: tempest1@1`
(partia wież LOD 1). A/B startu tym samym skryptem w jednym drzewie (`HULLFALL_AB_DIR` = pliki bazy `9d0e61fd`,
kolejność ABBA): baza i gałąź — ta sama piątka w każdym przebiegu. W jednym przebiegu `promien-gra.mjs` (obciążona
maszyna) było ich 14 — dochodziły mgławica, pył hali i kosmiczny, cień, partia kadłubów, światła nawigacyjne; wszystkie
przed montażem promienia.

### Wyniki 2026-10-20 (`promien-gra.mjs`: Colossus TN z AI kontra dwa pancerniki pirackie na jednej linii)

| Przypadek | Tryb off | Tryb worker |
|---|---|---|
| Gracz montuje promień (`DevScene.mountSpecial('death_ray')`) | 0 gniazd (odmowa — `npcOnly`) | 0 |
| Colossus TN (AI, gniazdo builtin x 813, `rot` 90) — wybór celu, ładowanie 4 s (80 rekordów `RAY_CHARGE`, laser do celu) | strzał w pierwszy pancernik (5,5 km) | to samo |
| Pierwszy pancernik (tarcza 7200, 12 000 HP, 742 węzły) | martwy (HP −8000), tarcza 0, 304 węzły wycięte, wrak | to samo |
| Drugi pancernik 2,5 km za nim, na tej samej linii | nietknięty (742 węzły, tarcza 7200, HP 12 000) | to samo |
| Po strzale: wieża bierze następny cel, przeładowanie | cel = drugi pancernik, 41,8 s do strzału | to samo |
| Rozkaz sceny (pancernik TN → piracki) / strzał wizualny | martwy (HP −8000) / wiązka bez trafień | to samo |
| Pipeline'y synchroniczne (render / compute / worker), także start gry | 0 / 0 / — | 0 (dziennik workera, cały przebieg) |
| Błędy konsoli | 0 | 0 (strona i worker) |

Zrzuty: `.tmp/promien-v2-off/*.png`, `.tmp/promien-v2-worker/*.png` (wieża na dziobie Colossusa — dziś proceduralna,
ładowanie z laserem do celu, czoło, wiązka kończąca się za pierwszym pancernikiem, rozpad, po 3 s). Testy:
`tests/deathRay.test.mjs` (15), `tests/deathRayNpc.test.mjs` (8); pełny zestaw — bez nowych błędów (9 zastanych).
