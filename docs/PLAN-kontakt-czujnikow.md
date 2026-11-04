# Wygląd KONTAKTU czujników i NAMIARU — propozycje (etap 1) i plan wpięcia (etap 2)

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

## 5. Namiar: wachlarz, struna, błona (druga runda, 2026-11-04)

Słowa użytkownika po odrzuceniu połówek: „ja to widzę jako taki łuk, który zaczyna wibrować, coś à la ta linia serca na
aparacie podtrzymującym życie, tylko bardziej płynna, wibrująca — niczym struna. Tak, struna, to jest dobre porównanie:
drgająca struna, tym mocniej, im bliżej wykrycia przez przeciwnika jesteś. Więc wachlarz (jeden!) jako propozycja + struna
+ jeszcze coś.” Pierwsza runda (dwie połówki przy okręcie gracza: PULS / FALA / ISKRY, commit `8582dd5e`) odpadła przez zły
brief; techniki wróciły w nowym układzie (bieg jasności i rozbłysk z PULSU, refrakcja z FALI).

Dane (te same dla trzech; grupa = bliscy siebie wrogowie w jednym miejscu, flota to jedna grupa): `d` — odległość;
`them` = ich czujniki × MOJA sygnatura / d (≥ 1 → WYKRYLI MNIE; mój ślad: ciąg ×1,35, cicha praca ×0,5, ostrzał do +60%);
`me` = moje czujniki × ICH sygnatura / d (≥ 1 → ja wykrywam ich); `est` = 1: ich czujniki zgadnięte z rozmiaru (kontakt
bez identyfikacji) → czerwień słabsza albo rwana.

Demo: tryb W (`?tryb=namiar`, `?namiar=wachlarz|struna|blona|porownanie`, `?scena=stany|przelot|grupy`, klawisz S), shadery
`dema/kontakty-czujnikow/namiarTSL.js`, sceny i stan zdarzeń `namiarDemo.js`. Atlas (3 km) i wróg (pancernik piratów, 1,2 km)
w JEDNYM kadrze 45 km, w realnej skali:

- STANY — trzy pasy: DALEKO (38 km, oni 53%, ja 45%), TUŻ PRZED PROGIEM (21,5 km, 93%, 79%), WYKRYTY (16,5 km, 121%, 103%);
- PRZELOT — pętla 27 s: wróg się zbliża (38 → 16,5 km, próg `them` przy 7,5 s, `me` przy 8,8 s) → cicha praca (ślad ×0,5,
  moje czujniki ×0,6: struna się zrasta, oni 61%) → ciąg (×1,35: pęka znowu, oni 164%) → normalny ślad → wróg odchodzi;
- GRUPY — trzy grupy: pancernik z eskortą (kręci się wokół progu), kontakt bez identyfikacji (wybrany OBŁOK, `est`),
  grupa poza kadrem (duże czujniki, już mnie widzi);
- PORÓWNANIE — trzy propozycje w trzech pasach, ten sam przelot.

Wróg w STANACH i PRZELOCIE jest rysowany sprite'em dla czytelności, z `est` = 0; w grze poza zasięgiem wzroku (18 km) byłby
OBŁOKIEM z `est` = 1 — to pokazuje scena GRUPY.

1. **WACHLARZ** — dokładnie jeden na okręt. Przy MNIE niebieski w stronę wroga (zapalonych łuków = `me` × 7), przy WROGU
   czerwony w stronę mnie (`them` × 7), na jednej prostej, naprzeciw siebie. Łuki STOJĄ, po nich biegnie jasność (szybciej
   przy progu), pod spodem słaby klin światła — jeden kształt, nie kreski. Przejście przez 1: pierścień leci przez wachlarz,
   całość się rozjarza; pełna długość z grotem = sięga. `est` — czerwień w kreskach. Wróg poza kadrem: wachlarz przy
   krawędzi ekranu na tej prostej.
2. **STRUNA** — jeden gładki łuk przy MOIM okręcie w stronę grupy, końce to nieruchome węzły (kołki). Drganie: suma pięciu
   harmonicznych `sin(nπs)·cos(ω_n τ)` o niewspółmiernych częstotliwościach (bez pików EKG), amplituda ∝ `them`³ (daleko
   ~1 px i wolno, przy progu ~±20 px), wyższe harmoniczne dochodzą po kolei (od 0,3 / 0,55 / 0,72 / 0,85); τ całkuje CPU
   (dτ = (1 + k²) dt) — struna „stroi w górę” bez skoków fazy. Trzy opóźnione próbki czasu dają ślad luminoforu (rozmycie
   ruchu w 60 kl/s). Napięcie: błękit bieleje. **Przy them = 1 struna PĘKA**: bicz (mody struny z jednym końcem wolnym,
   `sin((j−½)πh)`, amplituda zanika w ~0,3 s), rozbłysk, fala uderzeniowa z refrakcją tła (warstwa DIST), dwa czerwone
   rozedrgane końce; poniżej progu (z histerezą 0,975) zrastają się w ~0,2 s. To mój wybór z brief-u („struna, która pęka”)
   — alternatywą byłoby samo zaczerwienienie, ale nie jest „nie do przeoczenia”. Symetrycznie, słabiej (60% amplitudy
   i jasności, 104 px długości): struna przy wrogu w stronę mnie, drga z `me`, czerwona; gdy `me` ≥ 1 — pęka na błękitno
   (barwa końców = strona, która sięgnęła). `est` — struna rwana (komórki losowane 9 razy na sekundę) i słabsza.
3. **BŁONA** — jedna zamknięta, organiczna błona wokół MOJEGO okrętu, język OBŁOKÓW: kłęby fBm, pasma interferencji w dół
   ekranu, rzadki śnieg sygnału. Promień bazowy = mój ślad (cisza kurczy i przygasza, ciąg nadyma i rozjaśnia), w stronę
   każdej grupy wybrzuszenie rosnące z `them`³ i coraz węższe; przy progu brzeg drży i czerwienieje. Wiele grup = jeden
   kształt, zero osobnych znaczników (`me` nie jest pokazane — błona mówi tylko, co oni widzą; moje wykrycie pokazuje sam
   kontakt). them ≥ 1: w tym miejscu dziury w brzegu i czerwone smugi uchodzące na zewnątrz, rozbłysk i fala w kształcie
   błony, refrakcja. `est` — brzeg wybrzuszenia rwany, czerwień słabsza.

Sąsiednie grupy się nie nakładają: połowa kąta wachlarza i struny najwyżej 0,47 odstępu do najbliższego kierunku (krótsza
struna ma proporcjonalnie mniejszą amplitudę).

Zrzuty (`.tmp/kontakty/namiar/`): `60-namiar-porownanie-*` (chwile przelotu), `7k-<propozycja>-stany`, `-grupy`,
`-przelot-*`; animacje 60 kl/s z `--film-namiar 1`: `80-porownanie.webp` (pełna pętla, 3 pasy), `81-wachlarz.webp`,
`82-struna.webp`, `83-blona.webp` (zbliżenia piksel w piksel, 8 s przez próg). Pipeline'y
synchroniczne 0, błędy konsoli 0. Koszt (1600 × 900, scena STANY, pojedyncze próbki zegara GPU — orientacyjnie): pusta klatka
demo 0,065 ms, WACHLARZ 0,083, STRUNA 0,114, BŁONA 0,126 ms; w 5120 × 1440 nie mierzone. Ruch struny (odczyt z klatek, wiersz
przez środek łuku): przy ~75% zakres 12 px, skok między klatkami do 3 px; przy ~84% 20 px, do 5 px; przy ~95% 35 px, do 11 px.

Wpięcie (po wyborze): WACHLARZ i STRUNA przy moim okręcie są w zasięgu wzroku — kwad w passie gry; znacznik przy wrogu poza
wzrokiem leży pod mgłą (przygaszenie ×0,15–0,34) — trzeba go przenieść do postu po `applyFogOfWar`, jak kontakt (§ 4), albo
rysować całość w poście. BŁONA dotyczy tylko mojego okrętu — kwad w passie gry, bez bloku wroga. Dane: blok grup z migawki
workera (`P.fans`, poza gracza), stan zdarzeń (rozbłysk, szczelina, wiek, τ) po stronie widoku; refrakcja — siatka na
`FX_DISTORT_LAYER` zgłaszana z kroku efektów. Napisy zostają na kanwie 2D.

Decyzje: (4) która propozycja (albo połączenie, np. WACHLARZ przy wrogu + STRUNA przy mnie); (5) czy pęknięcie ma mieć dźwięk
i komunikat („WYKRYTY”); (6) czy błona ma pokazywać też `me`.
