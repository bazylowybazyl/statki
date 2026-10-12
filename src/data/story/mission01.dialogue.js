// ============================================================
// Misja 1 „Cicha baza” (dawniej „Cicha stocznia”) — KWESTIE DIALOGÓW. MIEJSCE NA FABUŁĘ.
//
// Tekst w [nawiasach] to zaślepka opisująca, co ma paść w scenie — do zastąpienia prawdziwym dialogiem.
// Kwestia: { who, text, portrait?, hold? } — `who` z obsady (src/data/story/cast.js), `portrait` nadpisuje
// portret obsady (np. inna mina), `hold` — ile sekund kwestia radia wisi po wypisaniu (domyślnie z długości).
// Sceny 'scene' czekają na gracza (Spacja / Enter / klik, Esc — pomiń), 'radio' lecą same w trakcie gry.
// Liczba kwestii w scenie jest dowolna — skrypt misji odtwarza całą tablicę.
// Misja 2 „Odwet” (odwet piratów, wsparcie, powrót do K-7): mission02.dialogue.js.
// ============================================================

export const MISSION01_TITLE = 'Cicha baza';

export const MISSION01_DIALOGUE = Object.freeze({
  // Atlas w hali K-7, po locie kamery. Odprawa: kto, co, gdzie, dlaczego.
  briefing: [
    { who: 'k7', text: '[Kontrola K-7 potwierdza gotowość Atlasa w stanowisku C-01.]' },
    { who: 'admiral', text: '[Odprawa: na obrzeżach układu coś się dzieje — ruch piratów, nic pewnego.]' },
    { who: 'intel', text: '[Wywiad: podejrzewamy ukrytą bazę — stocznię albo skład okrętów — ale nikt jej nie widział. Bez potwierdzenia.]' },
    { who: 'admiral', text: '[Rozkaz: skok w pobliże, rozpoznanie. Jeśli to baza piratów — wejść po cichu i zniszczyć, zanim wyprowadzą flotę.]' },
    { who: 'player', text: '[Dowódca przyjmuje rozkaz.]' }
  ],
  // Suwnice puszczają kadłub.
  undock: [
    { who: 'k7', text: '[Kontrola K-7: złączki odłączone, droga do bramy wolna. Powodzenia.]' }
  ],
  // Poza halą — kurs na cel.
  course: [
    { who: 'xo', text: '[Pierwszy oficer: kurs na obrzeża wyznaczony. Wyjdziemy z warpa w bezpiecznej odległości.]' }
  ],
  // Wyjście z warpa na obrzeżach — mgła wojny: czujniki grawitacyjne widzą tylko dużą masę (bez tożsamości).
  massContact: [
    { who: 'xo', text: '[Wyszliśmy z warpa. Czujniki grawitacyjne: duża masa przed nami, kilkadziesiąt kilometrów. Nic więcej nie widać.]' },
    { who: 'xo', text: '[Proponuję zwiad — dron albo ostrożne podejście. Nie dajmy się zobaczyć.]' }
  ],
  // To samo z fregatą zwiadu w ładowni (2026-10-11).
  massContactScout: [
    { who: 'xo', text: '[Wyszliśmy z warpa. Czujniki grawitacyjne: duża masa przed nami, kilkadziesiąt kilometrów. Nic więcej nie widać.]' },
    { who: 'xo', text: '[Fregata zwiadu w ładowni gotowa. Wypuśćmy ją i obleć to coś z daleka — Atlasa z bliska zobaczą.]' }
  ],
  // Fregata obleciała bazę — wszystkie budowle rozpoznane.
  reconDone: [
    { who: 'xo', text: '[Mamy pełny obraz bazy. Oznaczone cele zostają na mapie. Ściągaj fregatę.]' }
  ],
  // Rozpoznanie: to jest baza piratów.
  identified: [
    { who: 'xo', text: '[Mamy obraz! Baza piratów — habitat, pomosty pełne okrętów, większość w remoncie. Przy zbiornikach stoi coś dużego.]' },
    { who: 'intel', text: '[Wywiad: potwierdzamy. Plan bez zmian — wejść po cichu.]' }
  ],
  // Po rozpoznaniu — podejście w maskowaniu.
  arrival: [
    { who: 'xo', text: '[Nas jeszcze nie widzą. Maskowanie teraz.]' }
  ],
  // Maskowanie włączone.
  cloaked: [
    { who: 'xo', text: '[Maskowanie aktywne. Pełna cisza radiowa.]' }
  ],
  // Blisko rzędu zaparkowanych okrętów — przed taranem.
  ramOrder: [
    { who: 'player', text: '[Dowódca: pełna naprzód. Taranujemy.]' }
  ],
  // Alarm w bazie — po taranie (albo po wykryciu).
  alarm: [
    { who: 'pirate', text: '[Herszt: alarm! Kto to jest?! Wszyscy do dział!]' },
    { who: 'xo', text: '[Z habitatu startują drony — i ruszył supercapital przy zbiornikach. Bierzemy ich.]' }
  ],
  // Wykrycie przed taranem (maskowanie zdjęte za wcześnie).
  spotted: [
    { who: 'pirate', text: '[Herszt: mamy gościa! Otworzyć ogień!]' }
  ],
  // Zegar wodowania (2026-10-07): załogi biegną do okrętów na parkingu.
  crews: [
    { who: 'xo', text: '[Załogi biegną do okrętów przy pomostach — rozgrzewają reaktory. Mamy niecałą minutę, zanim pierwszy wystartuje.]' },
    { who: 'xo', text: '[Co zniszczymy w stanowiskach, nie będzie z nami walczyć.]' }
  ],
  // Pierwszy okręt z parkingu wychodzi przez bramę stanowiska.
  firstLaunch: [
    { who: 'xo', text: '[Pierwszy okręt odchodzi od pomostu — rufą ze stanowiska!]' }
  ],
  // Pochylnie w hali: pancerniki w budowie kończą wodowanie.
  slipWarn: [
    { who: 'intel', text: '[Wywiad: drony piratów w powietrzu. Wypuść myśliwce — zajmą się nimi.]' }
  ],
  slipLaunch: [
    { who: 'xo', text: '[Druga fala dronów z habitatu!]' }
  ],
  // Supercapital poniżej 2/3 punktów: herszt każe startować wszystkim od razu.
  bossRush: [
    { who: 'pirate', text: '[Herszt: wszystko, co ma silniki — w górę! Natychmiast!]' },
    { who: 'xo', text: '[Przyspieszają starty przy pomostach!]' }
  ],
  // Supercapital poniżej 1/3: ucieka i ładuje skok.
  bossFlee: [
    { who: 'xo', text: '[Supercapital zawraca — ładuje skok! Jeśli ucieknie, wróci z resztą floty.]' }
  ],
  bossKilled: [
    { who: 'xo', text: '[Supercapital zniszczony! Herszt nie wyszedł z tego żywy.]' }
  ],
  // Mostek zniszczony — okręt bez dowodzenia.
  bossHulk: [
    { who: 'xo', text: '[Mostek supercapitala trafiony — okręt bez dowodzenia, dryfuje.]' }
  ],
  bossEscaped: [
    { who: 'pirate', text: '[Herszt: to jeszcze nie koniec…]' },
    { who: 'xo', text: '[Uciekł. Wróci — i nie sam.]' }
  ],
  // Okręty bazy rozbite — czas na habitat.
  defencesDown: [
    { who: 'xo', text: '[Okręty piratów rozbite. Teraz habitat — serce bazy.]' }
  ],
  // Habitat wylatuje w powietrze.
  shipyardDown: [
    { who: 'xo', text: '[Habitat pęka! Bęben się składa — dysk pod nim idzie razem z nim!]' },
    { who: 'pirate', text: '[Herszt: zapłacisz za to…]' }
  ],
  // Koniec misji 1 — w polu, nad gruzami (dalej misja 2: naprawa, odwet).
  yardVictory: [
    { who: 'admiral', text: '[Admirał: baza zniszczona. Dobra robota — ale zostańcie w rejonie, piraci tego nie zostawią.]' }
  ],
  // Porażka (Atlas zniszczony).
  chainReaction: [
    { who: 'xo', text: '[Zbiorniki paliwa! Ogień idzie rurami wzdłuż pomostów — okręty w stanowiskach wybuchają jeden po drugim!]' }
  ],
  warehouseDown: [
    { who: 'xo', text: '[Magazyn piratów rozbity. Ich łup leci w próżnię.]' }
  ],
  defeat: [
    { who: 'xo', text: '[Tracimy okręt!]' }
  ]
});
