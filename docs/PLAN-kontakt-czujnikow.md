# Wygląd KONTAKTU czujników i WACHLARZY namierzania — propozycje (etap 1) i plan wpięcia (etap 2)

2026-11-04. Wątek poboczny mechaniki zasięgu radarów (`docs/PLAN-zasieg-czujnikow.md`, reguła `zasieg-czujnikow` —
w gałęzi prototypu). Prośba użytkownika: „osobna sesja, żeby wykorzystała zaawansowane shadery WebGPU do stworzenia
fajnych elementów — jakichś nieznajomych morfujących kształtów / chmurek”. W Starsectorze kontakt to małe i duże
trójkąty; w HULLFALL ma być coś własnego.

Stan: **KONTAKT wybrany; namiar (wachlarz / struna / błona) — druga runda propozycji.** Gra bez zmian.

## 0. Decyzje użytkownika

- 2026-11-04, ocena dema: „obłoki są super, a echo jest dobre na asteroidy” → nieznany KONTAKT = **OBŁOK**; **ECHO** =
  wygląd skał / asteroid. WIR i RÓJ odpadają. Wpięcie w grę po rundzie namiaru (prototyp zasięgu nie jest jeszcze w commicie).
- 2026-11-04, ocena wachlarzy PULS / FALA / ISKRY: odrzucone, bo brief był błędny — „kompletnie nie podobają mi się
  wachlarze … miałem na myśli wachlarz ode mnie i OD przeciwnika, w sensie że przeciwnik też ma swój wachlarz, a nie że ja
  mam dwa”. Układ dwóch połówek przy okręcie gracza znika.

## 1. Co obraz ma oddać

- KONTAKT = „coś tam jest, ale nie wiesz co”: wykryty czujnikami (poziom `SENSOR_LEVEL` KONTAKT), bez identyfikacji.
- ROZMIAR z obrazu: 4 klasy sygnatury `MAŁY` / `ŚREDNI` / `DUŻY` / `OGROMNY` (`contactSizeClass`, progi 0,6 / 0,9 / 1,2).
- MIEJSCE NIEPEWNE: promień `err` (0 na granicy wzroku → 7% odległości na granicy wykrycia), punkt wędruje (`contactOffset`,
  nowe losowanie co 2,5 s, płynnie). Kształt ma to oddać (rozmyty brzeg, falowanie), nie ostry symbol.
- BEZ STRONY I KLASY: barwa „nieznany” jak NTDS (bursztyn, `RADAR_RGB.unknown`), nie czerwień wroga ani błękit swoich.
- FLOTA: bliskie kontakty zlewają się w jeden kształt (pole = suma — metakule), nie milion znaczków.
- Styl gry: mgła wojny z sygnaturami masy (wir z ciemnym jądrem — `src/3d/fog/fogOfWarPost.js`), echo radaru PPI
  kokpitu (luminofor — `src/ui/radar/`).

## 2. Demo

`dema/kontakty-czujnikow.html` (Vite: `npm run dev` → `/dema/kontakty-czujnikow.html`), shadery
`dema/kontakty-czujnikow/kontaktyTSL.js`. Klawisze: `1`–`4` propozycja, `5` porównanie 2 × 2, `0` dzisiejszy znacznik
prototypu (przerywane koło z „?”), `S` scena (plansza rozmiarów / jak w grze), `L` podpisy, `T` prawdziwe miejsca,
`Z` daleki zoom (kadr 180 km, jak CIC), spacja pauza, `H` bez paneli; LPM przesuwa, kółko zoom. Adres:
`?wariant=0..4|porownanie`, `?scena=plansza|gra`, `?podpisy=0`, `?daleko=1`, `?clean=1`, `?test=1` (klatki z harnessu).
Zrzuty: `node scripts/webgpu/kontakty-demo.mjs [--out .tmp/kontakty/demo]` (headless Chrome — nie przy grze użytkownika).

- PLANSZA (kadr 45 km — najdalszy zoom gry): rząd 4 rozmiarów przy tej samej niepewności ±0,9 km; ten sam DUŻY przy
  ±0,25 / 1,3 / 2,6 km; flota ×6 (OGROMNY, 2 DUŻE, ŚREDNI, 2 MAŁE); para ŚREDNICH, która zbliża się (1 km) i rozchodzi
  (7 km); Atlas w rogu (źródło wiązki radaru dla ECHO).
- JAK W GRZE: Atlas, krąg wzroku 18 km, kontakty dalej — flota piratów (31 km), czata, 3 myśliwce w kółko, OGROMNY
  na 38 km; niepewność z odległości jak w modelu (0,07 × d × udział drogi od wzroku do granicy wykrycia 58,5 km).
- PORÓWNANIE 2 × 2: w każdej ćwiartce rozmiary, flota pięciu i para.
- Miejsce kontaktu jak w prototypie: przybliżone (prawda + przesunięcie `contactOffset`) odświeżane co 0,2 s, obraz goni
  je wykładniczo (τ 0,45 s) — skok co 0,2 s nie wychodzi na ekran (w etapie 2 tak samo: wygładzanie po stronie widoku).

## 3. Propozycje

Wspólne: JEDNA funkcja TSL na piksel nad blokiem kontaktów (`uniformArray` `kontaktyCzujnikow`: nagłówek 4 × vec4 +
2 × vec4 na kontakt — A = (x, y, R, err) w j. względem środka kadru, B = (klasa, masa, ziarno, alfa); ≤ 48 kontaktów),
pętla z odrzuceniem po zasięgu, szum `fxNoise.noise3D` zakotwiczony w świecie (początek kafla 40 km w double na CPU),
hasze PCG. „Ciało” kontaktu R: MAŁY 380 j., ŚREDNI 600, DUŻY 900, OGROMNY 1350 (najmniej 6 / 8 / 10 / 13 px — daleki zoom).

1. **ECHO — plama-echo luminoforu.** Metakule: centrum + 2–5 płatów (liczba z klasy) krąży wokół punktu z
   promieniem ∝ R i err; pole + szum świata na brzegu (falowanie rośnie z niepewnością). Jasny brzeg (HDR — bloom),
   warstwice co 0,55 pola w środku (cięższy = wyższe pole = więcej warstwic), ziarno i linie skanu w wypełnieniu, słaba
   przerywana OBWIEDNIA niepewności (gdzie może być — przy dużym err płaty rozchodzą się w osobne „hipotezy”, obwiednia
   trzyma je razem). Malowanie wiązką radaru Atlasa (2,4 s jak tarcza kokpitu): plama jaśnieje przy przejściu wiązki
   i gaśnie jak luminofor.
2. **OBŁOK — obłok zakłóceń.** Dwa przebiegi: wagi (niepewność, R) → przesunięcie punktu szumem → pole gaussów
   (σ ∝ R + err) × fBm (grube kłęby × drobna faktura; postrzępienie rośnie z niepewnością). Miękka chmura chłodnej
   szarości przechodząca w bursztyn tam, gdzie gęsta, ciepły rdzeń cięższych, pasma interferencji płynące w dół ekranu,
   rwane wiersze (co 1/7 s część wierszy przeskakuje w bok — zakłócony odbiór), rzadki „śnieg” sygnału (iskry co klatkę),
   lekkie przesłonięcie gwiazd.
3. **WIR — wir masy.** Ciemne jądro (promień 0,72 R + 0,2 err, alfa do 0,95 — „połyka” gwiazdy) i szeroki cień studni
   (gwiazdy wokół przygaszone do ~70%), pierścień ciepłego pyłu w ramionach spirali logarytmicznej (2 ramiona, DUŻY
   i OGROMNY — 3; wzór obraca się sztywno, nie nawija się), cienki fioletowy horyzont na brzegu jądra (rozmyty
   niepewnością), słaba fioletowa poświata. SOCZEWKA: `Core3D.fxDistortion().implode` na kontakt (siła ∝ jądro na
   ekranie i klasa). Najbliżej obecnej mgły wojny (sygnatury masy). Pierwsza wersja (skręt przestrzeni szumu ucinany na
   zasięgu kontaktu) dawała „słoje” na brzegach zasięgu i jasne pierścienie — ramiona są dlatego analityczne per kontakt.
4. **RÓJ — drobiny prawdopodobieństwa.** Iskry w komórkach ~6,5 px w pierścieniach biegunowych wokół kontaktu; każdy
   pierścień obraca się sztywno (środek szybciej — rój krąży), iskra żyje 0,55–1,5 s i odradza się w innym miejscu
   komórki; szansa iskry = gęstość gaussa (σ ∝ R + err) × klasa — gęstość iskier = prawdopodobieństwo miejsca. Iskry
   wydłużone wzdłuż orbity (smuga ruchu), HDR; pod spodem słaba wspólna poświata (flota = jeden rój).

Demo pokazuje też dzisiejszy znacznik prototypu (wariant 0) do porównania.

Zrzuty (2026-11-04, `.tmp/kontakty/demo/`, headless 1600 × 900): `00-porownanie` (2 × 2), `1k-<propozycja>-plansza`,
`2k-<propozycja>-gra`, `3x-*-ruch-*` (klatki co 1,5 s), `40-dzis-plansza`, `41-echo-prawda`; animacja porównania
`50-porownanie-ruch.webp` (48 klatek z `--film 1`, złożone PIL — animowany WebP 800 × 450, ~1,8 MB). Pipeline'y
synchroniczne 0, błędy konsoli 0. Koszt (pojedyncze próbki zegara GPU, orientacyjnie): pusta klatka demo 0,065 ms,
ECHO 0,107, OBŁOK 0,14, WIR 0,12, RÓJ 0,10 ms (15 kontaktów); porównanie 2 × 2 ~0,2 ms.

## 3b. Decyzje dla użytkownika

1. Która propozycja (albo połączenie — np. RÓJ w kadrze bojowym, ECHO w CIC; WIR dla bardzo dużych sygnatur).
2. Czy podpis rozmiaru („DUŻY”, „? ×N”) zostaje obok kształtu, czy kształt ma wystarczyć.
3. Czy echo ma się „malować” wiązką radaru Atlasa (ECHO: jaśnieje co 2,4 s), czy świecić równo.

## 4. Etap 2 — wpięcie (po wyborze)

- KONTAKT LEŻY POD MGŁĄ WOJNY (poza wzrokiem), a mgła w „uber” przygasza i odbarwia wszystko pod sobą (×0,15–0,34) —
  rysunek w scenie zginąłby. Wybrana funkcja idzie do postu PO `applyFogOfWar` (`src/3d/tsl/postGry.js`): punkt świata
  piksela już tam jest (`fogRelPoint` — także kamery 3D i rulon), blok kontaktów jako drugi `uniformArray` postu (limit
  12 buforów na etap — dziś post ma 5 + rulon) albo dopisany do bloku mgły; gałąź za uniformem (`uContactCount > 0`) —
  bez kontaktów obraz bit w bit. Bloom: post liczy bloom PRZED „uber”, więc kontakt w poście nie dostaje poświaty —
  jasność brzegów / iskier dobrać do obrazu bez bloomu (albo poświata w samej funkcji). Soczewka wiru — `fxDistortion`
  jak w demie (gałąź zniekształceń już jest w „uber”).
- Dane: z gry `P.knowList` (`level === 1 && !ident`: `x`, `y`, `err`, `sigSeen` → `contactSizeClass`) — przez rekord
  migawki (render w workerze, zasada 6: blok `contacts` w `snapshotLayout` albo strumień rozkazów), wygładzanie miejsca
  po stronie widoku (τ ~0,45 s; obraz workera ma swój zegar klatki), zanik przy zgubieniu (duch 25 s — alfa).
- 2D nakładka prototypu (`radarRangeOverlay.js`) zostaje dla podpisu rozmiaru / „? ×N” (opcjonalnie) — sam kształt
  rysuje post. CIC (kanwa 2D) dostaje własny, prosty odpowiednik wybranej propozycji (stemple — reguła `radar-cic`).
- Koszt do zmierzenia w grze (5120 × 1440): pętla po kontaktach na piksel z odrzuceniem po zasięgu; przy wielu
  kontaktach — pudła kontaktów na CPU i odrzucenie piksela poza sumą pudeł (jak pudła maski słońca), RÓJ / ECHO bez
  tekstur w pętli.
- Rozgrzewka: gałąź postu kompiluje się z „uber” (pod kurtyną) — bez nowych pipeline'ów w grze.

## 5. Wachlarze namierzania „) ) )” (rozszerzenie zakresu, 2026-11-04)

Prośba (przez sesję główną mechaniki zasięgu): „każ sesji dorobić, zobaczymy, co nam nastruga” — 2–3 warianty efektu
wachlarzy przy okręcie gracza w tym samym demie i języku wizualnym. Semantyka prototypu (`drawBearingFans`,
`radarRangeOverlay.js`; dane `P.fans`, `sensorPicture.js`) zostaje: na grupę wrogów w jednym kierunku dwie połówki
krótkich łuków w stronę wroga — NIEBIESKA = MÓJ zasięg względem nich (`me` = moje czujniki × ich sygnatura / odległość),
CZERWONA = ICH zasięg względem mnie, mój ślad sygnałowy (`them`); zapalonych łuków = ułamek × 7, puste miejsca słabo,
pełny wachlarz z grotem = sięga, cicha praca skraca czerwony, radar zgadnięty (`est`) słabiej. Łuki STOJĄ przy okręcie.

Demo: tryb W (`?tryb=wachlarze`, `?wachlarz=puls|fala|iskry|dzis|porownanie`), shadery
`dema/kontakty-czujnikow/wachlarzeTSL.js`, stanowiska `wachlarzeDemo.js`. Plansza: sześć stanowisk (Atlas w kadrze
45 km) — DALEKO, BLISKO PROGU, SIĘGA, KILKA GRUP (4 kierunki, jeden radar zgadnięty), CICHA PRACA, PRZEJŚCIE PRZEZ PRÓG
(ułamki falują przez 1 — rozbłyski); przy grupach podpis „TY x% · ONI y%”. Porównanie: PULS, FALA, ISKRY i dzisiejszy
rysunek 2D, w każdej ćwiartce okręt z czterema grupami (daleko, przy progu — przechodzi przez 1, sięga, zgadnięty).

1. **PULS** — łuki świecą (rdzeń HDR ~1, wąska poświata), od okrętu biegnie po zapalonych łukach miękki puls —
   tym szybszy, im bliżej progu (bicie serca). Przejście przez 1: rozbłysk — pierścień przelatuje przez wachlarz,
   połówka się rozjarza; potem „żar”: łuki migoczą, grot oddycha małą poświatą. Zgadnięty radar — łuki w kreskach.
2. **FALA** — grzbiety fal (co 1,5 odstępu łuków, nie pokrywają się ze skalą) płyną od okrętu do granicy zasięgu,
   pod nimi wyraźne łuki skali; tło NAPRAWDĘ się zgina (warstwa DIST Core3D — przesunięcie w px wzdłuż promienia,
   aberracja barw z „uber”). Sięga: co ~1,8 s przez wachlarz i dalej przechodzi fala uderzeniowa. Zgadnięty — grzbiety
   rwane.
3. **ISKRY** — łuki z kropek, które płyną od okrętu (każda wędruje od łuku do następnego i odradza się; szybciej przy
   progu), migocą; na granicy zasięgu migocący front; sięga — kropki dolatują do grota, który iskrzy. Zgadnięty —
   połowa kropek i słabiej. Spójne z RÓJ kontaktów.

Zrzuty (`.tmp/kontakty/demo/`): `60-wachlarze-porownanie`, `61-…-panele`, `62-wachlarze-puls`, `63-…-fala`,
`64-…-iskry`, `65-…-dzis`; animacja porównania `70-wachlarze-ruch.webp` (64 klatki co 0,1 s). Koszt (orientacyjnie,
1600 × 900, 9 grup): PULS 0,095, FALA 0,13, ISKRY 0,097 ms GPU na klatkę przy pustej 0,065. Pipeline'y sync 0.

Wpięcie (po wyborze): okręt gracza jest w zasięgu wzroku, więc mgła wojny wachlarzy nie przygasza — kwad w passie gry
(warstwa 0) z blokiem grup (≤ `fanMaxGroups` 6) w px bufora z migawki workera (`P.fans` + poza gracza i r0 z obrysu
kadłuba), FALA dodatkowo siatka na `FX_DISTORT_LAYER`; rozbłysk z czasu przejścia przez 1 (stan widoku). Napisy
(„ONI · TY · DO NICH”) zostają na kanwie 2D.

Decyzje: (4) który wariant wachlarzy (albo połączenie, np. PULS + rozbłysk FALI przy przekroczeniu progu);
(5) czy rozbłysk przy przejściu przez 1 ma mieć dźwięk / komunikat („WYKRYTY”).
