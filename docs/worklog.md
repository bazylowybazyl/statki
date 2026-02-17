# Worklog

Krotki dziennik zmian: co zmienione i dlaczego.

## Format wpisu

```
## YYYY-MM-DD
- [plik/obszar] co zmienione
  - dlaczego
  - wplyw / uwagi
```

---

## 2026-02-16
- [`src/game/destructor.js`] Ograniczone ustawianie `textureDirty` i `cacheDirty` tylko do trybu 2D (`!HEX_SHIPS_3D_ACTIVE`) w `repair`, `applyImpact`, `distributeStructuralDamage`.
  - Dlaczego: w trybie 3D te flagi wymuszaly zbedne odswiezanie CPU.
  - Wplyw: mniejsze obciazenie podczas trafien i napraw przy aktywnym `hexShips3D`.

- [`src/3d/core3d.js`, `planet3d.assets.js`, `src/3d/stations3D.js`, `index.html`] Usuniety stary pipeline cieni (shadow map + shadow catcher + 2D overlay cieni).
  - Dlaczego: przygotowanie czystej bazy pod nowy system oswietlenia i cieni.
  - Wplyw: brak legacy cieni mieszajacych sie z nowym wdrozeniem.

- [`src/3d/core3d.js`, `planet3d.assets.js`, `src/3d/stations3D.js`] Wdrozony nowy shadow catcher i dynamiczny rig cieni slonca.
  - Dlaczego: planety i stacje maja rzucac cien takze na "pustke", a shadow frustum ma podazac za kamera.
  - Wplyw: cienie 3D sa aktywne; zasieg i kierunek sa stabilizowane wzgledem pozycji kamery i globalnego polozenia slonca.

- [`src/3d/core3d.js`, `planet3d.assets.js`] Dostrajam parametry catchera i swiatla pod duze roznice warstw Z.
  - Dlaczego: przy niskim `sunLight.z` cienie uciekaly poza ekran mimo aktywnego shadow catchera.
  - Wplyw: lepsza szansa na widoczny cien na tle kosmosu (wieksza wysokosc swiatla, wiekszy frustum, mocniejsza warstwa catchera).

- [`index.html`] Wdrozone rozdzielenie cieni: long-shadows w swiecie + osobny cien stacji na powierzchni planety.
  - Dlaczego: cień stacji na planecie i oddzialywanie cienia na statki/budowle maja byc niezalezne.
  - Wplyw: planety i stacje rysuja "ogon" cienia, stacje maja lokalny cien klipowany do dysku planety, a statki dostaja overlay zaciemnienia z `computeWorldShadowAtPoint`.

- [`planet3d.assets.js`, `index.html`] Przejscie na prawdziwy odbior cieni 3D na planetach.
  - Dlaczego: planety mialy custom shader bez integracji `shadowmap`, wiec nie mogly pokazac cienia ze stacji GLB.
  - Wplyw: shader planet pobiera shadow map (`getShadowMask()`), a 2D overlay cienia stacji na planecie zostal wylaczony.

- [`planet3d.assets.js`] Poprawka kompilacji shadera planet po integracji shadow map.
  - Dlaczego: `shadowmap_vertex` wymagalo `transformedNormal`, a `getShadowMask()` musi byc warunkowy gdy `USE_SHADOWMAP` nie jest zdefiniowane.
  - Wplyw: zniknal crash po kliknieciu "Nowa gra"; shader kompiluje sie poprawnie.

- [`planet3d.assets.js`] Dodane `#include <shadowmask_pars_fragment>` do shadera planet.
  - Dlaczego: `getShadowMask()` nie jest definiowane przez samo `shadowmap_pars_fragment` w tej wersji Three.
  - Wplyw: usuniety blad kompilacji fragment shadera (`no matching overloaded function found`).

- [`planet3d.assets.js`] Poprawka `receiveShadow` + uniformy swiatel dla custom ShaderMaterial planet.
  - Dlaczego: `shadowmask_pars_fragment` uzywa `receiveShadow`, a material z `lights: true` potrzebuje uniformow z `UniformsLib.lights`.
  - Wplyw: usuniety blad `receiveShadow undeclared` i regresja `Cannot set properties of undefined (setting 'value')` podczas renderu.

- [`src/ui/hardpointEditor.js`, `src/ui/devTools.js`] Dodany osobny in-game edytor hardpointow/silnikow pod przyciskiem `Edytor` w DevTools (F10).
  - Dlaczego: reczne strojenie offsetow dla wielu statkow jest zbyt wolne.
  - Wplyw: mozna wybrac statek (player/carrier/battleship/destroyer/fregata), klasc markery na siatce z symetria, ustawiac silniki (pozycja/deg/offset), kopiowac i pobierac JSON.

- [`src/ui/hardpointEditor.js`] Poprawiony UX stawiania markerow + dodany tryb testu VFX silnikow pod klawisze.
  - Dlaczego: LPM czesto wybieral stary marker zamiast klasc nowy, a test silnikow wymagany byl bez recznego patcha.
  - Wplyw: LPM zawsze kladzie marker (Shift+LPM wybiera), nowy marker jest od razu zaznaczany; opcja `Test VFX (WSAD+QE+Shift)` nadpisuje `thrusterInput` gracza w petli edytora.

- [`src/ui/hardpointEditor.js`] Przebudowa UI edytora na "malowanie" z lewej palety i usuniecie panelu "Zaznaczony marker".
  - Dlaczego: potrzebny byl prostszy workflow drag&drop/malowania bez recznej inspekcji pojedynczych markerow.
  - Wplyw: lewy, scrollowany panel palety (hardpointy + dysze), podglad pedzla pod kursorem, malowanie LPM i kasowanie PPM.

- [`src/ui/hardpointEditor.js`, `index.html`] Stabilizacja edytora: bezpieczna skala sprite + podglad VFX + auto-pauza gry.
  - Dlaczego: marker mogl "znikac" przy niepoprawnym rozmiarze sprite, a VFX i gameplay mialy byc czytelne w trybie edycji.
  - Wplyw: poprawione liczenie skali przy pustym/niegotowym canvasie, dodany podglad plomienia dysz na kanwie edytora (WSAD/QE/Shift), oraz pauzowanie/wznawianie gry przy otwarciu/zamknieciu edytora.

- [`src/ui/hardpointEditor.js`] Uodpornione malowanie markerow i tryb VFX w edytorze.
  - Dlaczego: po hard resecie marker potrafil sie nie klasc, a WSAD nie odswiezal podgladu dysz.
  - Wplyw: LPM/drag ma fallback do poprawnego pedzla, input myszy blokuje propagacje do gry, VFX reaguje na WSAD takze przy narzedziu dyszy, odswieza sie co klatke i pokazuje "ghost jet" pod kursorem.

- [`src/ui/hardpointEditor.js`] Wzmocniona widocznosc markerow na spricie.
  - Dlaczego: markery zapisywaly sie logicznie, ale bywały niewidoczne na tle statku.
  - Wplyw: pozycje kliku sa clampowane do obszaru sprite, a markery maja wyrazniejszy rendering (jasny obrys, krzyz, glow i grot dla dysz).

- [`src/ui/hardpointEditor.js`] Dodany globalny badge pedzla pod kursorem.
  - Dlaczego: wybor narzedzia z palety nie byl jednoznacznie widoczny podczas celowania.
  - Wplyw: przy ruchu myszy w edytorze wyswietla sie etykieta + kolor aktualnego pedzla obok kursora (niezaleznie od warstwy canvas).

- [`src/ui/hardpointEditor.js`] Dodana `Gumka` jako pelne narzedzie z lewej palety.
  - Dlaczego: szybkie usuwanie markerow bez PPM i bez zmiany workflow malowania.
  - Wplyw: LPM/drag w trybie Gumka usuwa markery obszarowo (z uwzglednieniem symetrii), a badge/podglad kursora pokazuje tryb kasowania.

- [`index.html`] Wejscie do edytora przeniesione do glownego menu pod przycisk `Edytor` (zamiast `Opcje`).
  - Dlaczego: uruchamianie edytora ma byc szybkie i dostepne bez DevTools.
  - Wplyw: klik z menu laduje dynamicznie `src/ui/hardpointEditor.js` i otwiera edytor; zachowany code-splitting.

- [`index.html`] Korekta menu: `Opcje` przywrocone, `Edytor` dodany jako osobny przycisk pod `Opcje`.
  - Dlaczego: potrzebne sa oba wejscia jednoczesnie.
  - Wplyw: `Opcje` znow otwieraja widok konfiguracji, a `Edytor` uruchamia hardpoint editor.

- [`index.html`, `src/ui/hardpointEditor.js`] Pelny flow uruchamiania edytora z menu (z loading overlay i powrotem do menu po zamknieciu).
  - Dlaczego: menu przebijalo sie podczas wejscia do edytora; potrzebny byl ten sam poziom inicjalizacji UI co przy starcie gry.
  - Wplyw: przycisk `Edytor` pokazuje loading, chowa menu/HUD przed otwarciem i po zamknieciu edytora przywraca menu przez callback `__onHardpointEditorClosed`.

- [`src/ui/hardpointEditor.js`] Przejscie na Pointer Events + bezpieczny zapis stanu.
  - Dlaczego: klik/malowanie mialo byc stabilne na myszce i dotyku, a blad localStorage nie moze blokowac odswiezania UI.
  - Wplyw: `pointerdown/move/up` w canvas, warunek LPM zluzowany dla touch i `persist()` ma `try/catch` z ostrzezeniem.

- [`src/ui/hardpointEditor.js`] Ujednolicenie warstwy kursora i canvasa.
  - Dlaczego: zdarzaly sie rozjazdy badge vs canvas oraz podwojne renderowanie znacznika kursora.
  - Wplyw: canvas ma `position:absolute; inset:0`, badge jest synchronizowany z `onCanvasMove`, a canvasowy badge został wyłączony.

- [`src/ui/hardpointEditor.js`] Testowe przejście na nasłuch myszy w wrapperze canvasa.
  - Dlaczego: podejrzenie, że część kliknięć nie docierała do samego canvasu.
  - Wplyw: eventy `mousedown/mousemove/mouseup/mouseleave/wheel` są podpięte do `.hp-canvas-wrap`, a `onCanvasDown` akceptuje malowanie dla przycisku lewego lub braku `button`.

---

## 2026-02-17
- [`src/game/shipEntity.js`, `index.html`, `src/3d/hexShips3D.js`] Podpięta normal mapa gracza (`assets/capital_ship_rect_v1_normal.png`) i nowe oświetlenie day/night dla statków hex.
  - Dlaczego: potrzebny efekt „pół na pół” jak na planetach zamiast płaskiego bloom/ambient.
  - Wplyw: statek gracza korzysta z normal mapy po `initHexBody`, a shader statków ma wyraźną stronę dzienną i nocną (z miękkim terminatorem + tłumionym specularem nocą).

- [`src/3d/hexShips3D.js`] Dodany live panel F12 do strojenia day/night na statkach (`window.__shipLightPanel`).
  - Dlaczego: szybkie dopasowanie granicy terminatora i jasności strony nocnej bez kolejnych patchy.
  - Wplyw: `open/close/reset/status` + suwakowe UI wpływające na uniformy shadera w runtime (dla wszystkich statków hex).

- [`src/ui/hardpointEditor.js`] Dodane jednostki pirackie do listy statkow edytora (`pirate_battleship`, `pirate_destroyer`, `pirate_frigate`) z dedykowanymi sprite'ami.
  - Dlaczego: potrzebna edycja hardpointow i dysz takze dla floty pirackiej.
  - Wplyw: export JSON zawiera teraz osobne profile dla statkow pirackich.

- [`index.html`, `src/3d/hexShips3D.js`, `src/ai/capitalAI.js`] Dopieta warstwa runtime dla layoutow NPC z edytora hardpointow (hardpointy + dysze).
  - Dlaczego: NPC miały strzał z centrum i brak podpięcia pod konfigurację edytora.
  - Wplyw: gra czyta `hpEditor.v1`, mapuje layout na typy NPC (terran/piraci), strzały AI mogą wychodzić z hardpointów, markery hardpointów są rysowane na statkach, a VFX silników działa też dla encji bez `hexGrid`.

- [`src/game/npcHardpointRuntime.js`, `index.html`] Przeniesiona logika runtime hardpointow NPC z `index.html` do osobnego modulu.
  - Dlaczego: ograniczenie rozrostu `index.html` i przygotowanie pod dalszy podział systemu statkow.
  - Wplyw: storage/poll/layout apply/origin z hardpointu dzialaja przez `createNpcHardpointRuntime`, a `index.html` zostal odchudzony.

## TODO (krotkoterminowe)
- Dostroic parametry cieni (`mapSize`, `bias`, `normalBias`, `frustumMin/Max`) pod wydajnosc i jakosc.
- Dodac `docs/architecture.md` (pozniej, zgodnie z ustaleniem).
