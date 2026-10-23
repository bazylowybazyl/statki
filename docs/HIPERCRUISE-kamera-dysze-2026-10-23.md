# Hipercruise: kamera za statkiem, bez ośrodka, dysze „nie ma / jest” (2026-10-23)

Zgłoszenie użytkownika (cytat): „hipercruise w grze: kamera jak w warp — odpalenie hipercruise = przestawienie kamery
za statkiem. usunięcie efektu cząsteczkowego, poprawienie dyszy — brak ognia, hipercruise odpalony = ogień — zrobić
fajny efekt nie ma / jest. poruszanie się silników na boki podczas hypercruise — dostosować, żeby się nie wyginało tak
mocno.”

Stan i zasady: reguły `kamera` (OBRÓT KADRU W HIPERCRUISIE), `core3d` (OBRÓT KADRU), `warp` (EFEKT HIPERCRUISE'U),
`silniki` (plazma hipercruise'u), `statek-gracza` (HIPERCRUISE). Testy `tests/hypercruiseLook.test.mjs`.

## 1. Kamera za statkiem — obrót kadru w grze

Odczyt zgłoszenia (orkiestrator): jak w demie „Pęd” (klawisz K) — od odpalenia hipercruise'u kadr obraca się kursem
w górę, statek siedzi nisko, przed dziobem widać, co nadlatuje; po wyjściu kadr wraca do północy. To pierwszy port obrotu
kadru (`cam.roll`, `src/render/viewRoll.js`) do gry.

- Oś czasu: `updateCameraHyperRoll` (czas gry) → `stepCameraRigRoll`: rozruch i lot — kurs (dziób) w górę, hamowanie
  wyjścia — trzymane (`hold`), potem `warpRollHold` (0,5 s), powrót sprężyną `warpRollOmega` (3,2/s, ~1 s na 90°).
- Gdzie NIE ma obrotu: RTS, podzielony ekran, kamery 3D, ujęcia fabuły, przejście fokusu, warp gracza (warp gry bez zmian),
  opcja „Północ”.
- Zoom: zostaje zoom gracza × kop hipercruise'u (`warpZoomOut`). Ujednolicony zoom dema (`zoomRef`) nie jest wpięty —
  w hipercruisie gracz sam dobiera kadr, a statek przy każdym zoomie mieści się nad HUD-em (niżej). Do zmiany na życzenie.
- Rig: przy kursie w górę i wyprzedzeniu na maksimum (20–40 tys. j/s ≫ limit lotu) rufa z dyszami chowała się pod
  kokpitem (zrzut zbliżenia: zapłon niewidoczny). W hipercruisie do pasów HUD dochodzi półwymiar kadłuba w pionie ekranu
  (waga gładka 2,5/s) — cała sylwetka zostaje nad HUD-em; przy dużym zoomie statek wraca bliżej środka.
- Sterowanie bez zmian: A/D obraca dziób (kurs prowadzi automat), kadr idzie za dziobem — świat obraca się wokół statku,
  dziób zostaje w górze; A skręca w lewo na ekranie jak w kamerze pościgowej.

### Inwentarz rzutów świat ↔ ekran (stan po porcie)

Z obrotem przez centralne rzuty `worldToScreenInto` / `screenToWorld` (`index.html`):
celownik broni i znacznik trafienia (pozycja kursora, kąty z ekranu), kompas łuków (`drawArcCompass` — kurs kadłuba przez
`screenAngleFor`), HUD kursu warpa (`warpCourseOverlay.js` — kąty z rzutów), znaczniki kontaktów (`contactMarkers.js`),
celów misji (`missionTargetMarkers.js`), mgły wojny (`fogHud.js`), skanera X (`scanOverlay.js` — namiary stacji przez
`view.screenAngle`), nakładki fabuły (`storyOverlay.js`), etykiety planet i stacji, nakładki NPC (paski, kadłuby,
myśliwce — `screenAngleFor`), liny holownicze, fale CanvasVFX, infrastruktura stacji, drony zwiadu (`spotterDrone.js`),
Hexlance (`superweapon.js`), pociski kanwy (`canvasParticleSystem.js`), znacznik stabilizatora, strzałki nawigacji,
sprite gracza 2D; mysz → świat: menu PPM, wybór celu (T / U, malowanie), celowanie kierowania ogniem, spawn z kokpitu,
LINIE.
Kamery 3D (View3D) i ich rzuty — bez obrotu (obrót tylko kamery z góry). Radar kokpitu i CIC — północ w górę.

Moduły renderu liczące same (uzupełnione): pudło cullingu kadłubów (`fillHexCullInfo` — z niego też LOD dysz MAIN),
bramka efektów trafień, okno gazu przestrzeni, komety (`_inView`), mgła wojny w poście (`uFogRot` + pudło kół),
pył kosmiczny (wzór i smugi w osiach ekranu — `G4.yz`). Wcześniej z obrotem: Core3D (kamery three), maska słońca, gorące
powietrze, zniekształcenia, kadr efektów, warp „Nurt”, soczewka świata, planety, pas, ringi. Stacje (`updateStations3D`
bez pudła) — bez zmian. Worker: `HEAD.CAM_ROLL` / `CAMNS_ROLL` → `cam.roll` / `camNs.roll`.

Bez obrotu zostają (świadomie): ramki zaznaczenia jednostek (pudła osi ekranu z wymiarów kadłuba — przybliżenie),
klin zwiadu fregaty (sterowanie fregatą w hipercruisie niemożliwe), pan kamery RTS myszą.

## 2. Efekt cząsteczkowy

Zrzuty faz (`node scripts/webgpu/hipercruise-efekt-gra.mjs`, przed zmianą): dominuje ośrodek „Nurtu” — turkusowa chmura
drobin przed statkiem i pomarańczowy warkocz za nim od rozruchu do wyjścia (bańka hipercruise'u to przegródka ośrodka).
Plazma WARP i iskry strugi MAIN — małe, nie czytają się jako „efekt cząsteczkowy”. W hipercruisie ośrodek jest wyłączony
(bez przegródek i poświaty drobin — ośrodek się nie budzi); zostają smugi gwiazd, fale, błysk kopu, żar kadłuba.
A/B: `?hcOsrodek=1`.

SOCZEWKA BAŃKI na mgławicy: zostaje (zgięcie mgławicy wokół statku — ślad bańki na tle, bez drobin).

OBSERWACJA (zastana, poza zakresem): jasny „stożek” z prostymi, zbieżnymi krawędziami w tle wzdłuż kursu przy szybkim
locie — widoczny na zrzutach PRZED i PO zmianach (tryb off i worker), w passie tła, w barwie mgławicy; nie zmieniają go
ośrodek, soczewka bańki (przebieg z wyłączoną soczewką — dalej jest), bloom, zniekształcenia, gorące powietrze, gaz, pył.
Krawędzie zbiegają się ZA statkiem, a harness zawsze startuje lot prosto od Ziemi — najpewniej to smuga cienia Ziemi na
tle (maska słońca, „długa smuga cienia”), która w tym ustawieniu leży wzdłuż kursu (wyłączenie passa maski w sondzie nie
czyści jej tekstury, więc tamten A/B niczego nie rozstrzygnął). Do potwierdzenia lotem w innym kierunku; nie dotyczy
hipercruise'u.

## 3. Dysze „nie ma / jest”

Przed: rozruch (Atlas 4 s) palił plazmę jak ładowanie warpa; wyjście gasiło ją od razu. Teraz (`WARP_PLUME_HYPER`):
rozruch — żar wylotu bez płomienia, narasta ~1 s i drży (poświata wylotu 1,0–1,5 w sondzie, strumień niewidoczny);
start lotu — błysk ×1,5 od razu i pchnięcie płomienia (~0,2 s do szczytu, strumień ×1,75), potem praca z dopalaczem;
wyjście — 0,9 s dogasania z krztuszeniem (plazma w sondzie po 0,3 s wyjścia jeszcze się pali), potem gaszenie z
poświatą. Decyzja: w rozruchu bez płomienia — „nie ma → jest” zaczyna się przy starcie lotu; struga MAIN w rozruchu
pracuje wg ciągu (lot zwykły trwa). NPC z `__hyperMode` — ten sam wygląd.

## 4. Wygięcie na boki

Źródło (sonda skrętu, A przy pełnej prędkości): plazma jest sztywno przy dyszach (bez opóźnienia ani zgięcia), a na boki
obraca ją GIMBAL dysz MAIN — wychylenie −26° × moment (`applyPlayerThrusterVisualState`). Moment dysz MAIN idzie tylko
przy ciągu W (albo gdy kadłub nie ma dysz bocznych): w locie z W i A/D wszystkie 5 dysz Atlasa stało pod 26° do osi
(HEAD), sam A/D — 0°. W hipercruisie kurs prowadzi automat (gałąź fizyki bez momentu dysz), więc gimbal to sam obraz —
× `HYPERCRUISE_TUNE.nozzleGimbal` 0,2 → 5,2° (pomiar: HEAD 26,0°, po 5,2° na każdej dyszy; zrzuty
`.tmp/hc/gimbal-przed-p3.png` / `gimbal-po-p3.png`). Dysze SIDE przy skręcie pracują jak dotąd (impulsy na dziobie
i rufie — krótkie, bez zgięcia).

## Weryfikacja

- Zrzuty faz `node scripts/webgpu/hipercruise-efekt-gra.mjs` (off i `--query renderWorker=1`): kadr kursem w górę od
  rozruchu, statek nad kokpitem, bez ośrodka, plazma od startu lotu, HUD (celownik, podpis, znaczniki) w tych samych
  miejscach w obu trybach; po wyjściu północ. Pipeline'y synchroniczne po starcie: 0.
- Sonda plazmy (`.tmp/hc/sonda.mjs`, lokalnie): rozruch — strumień niewidoczny, poświata wylotu 1,0–1,5 (przed zmianą
  jasności żaru); zapłon — strumień widoczny; wyjście po 0,3 s — plazma jeszcze się pali (dogasanie).
- Sonda skrętu W + A (`.tmp/hc/sonda4.mjs`, na tym kodzie i na eksporcie HEAD po kolei): gimbal MAIN 26,0° → 5,2°.
- `node scripts/webgpu/hipercruise-gra.mjs`: ring, duch, olbrzym, koszt — bez zmian (krok fizyki w hipercruisie
  1,16 ms vs 1,15 ms w locie bojowym), pipeline'y sync 0 (strona i worker).
- `node scripts/webgpu/travel-gra.mjs`: TRAVEL TO, warp „Nurt”, wezwanie, POWRÓT — bez błędów konsoli.
- Testy: `node --test "tests/*.test.mjs"` 3242 ok; porażki zastane (te same na eksporcie HEAD: `hallGas` LF,
  `shadowShaftsQuality` emitery), TODO `PORT poprawka 1/3`, chwiejne pod obciążeniem (`cicBeltLayer` budżet czasu,
  `capitalAiFlight` — w izolacji 3/3 ok). `npm test` — wszystko OK. Build Vite — OK.
