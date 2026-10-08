// ============================================================
// Misja 2 „Odwet” — KWESTIE DIALOGÓW. MIEJSCE NA FABUŁĘ.
//
// Format jak w mission01.dialogue.js: { who, text, portrait?, hold? }, `who` z obsady (src/data/story/cast.js).
// Tekst w [nawiasach] to zaślepka opisująca, co ma paść.
// ============================================================

export const MISSION02_TITLE = 'Odwet';

export const MISSION02_DIALOGUE = Object.freeze({
  // Zaraz po misji 1, nad gruzami stoczni: naprawa przed odwetem.
  // AGENT: naprawa w polu przez okręt wsparcia z rojem dronów naprawczych — kwestie okrętu naprawczego tutaj.
  repair: [
    { who: 'xo', text: '[Raport uszkodzeń: kadłub naruszony w kilku sekcjach. Naprawiamy, póki jest cicho.]' },
    { who: 'intel', text: '[Wywiad: przechwytujemy ruch piratów w głębi obrzeży. Mają może minutę.]' }
  ],
  // Fala 1: lekkie okręty z głębi obrzeży.
  wave1: [
    { who: 'xo', text: '[Sygnatury warpa! Pierwsza fala — fregaty i niszczyciele.]' },
    { who: 'pirate', text: '[Herszt: nikt stąd nie wyleci.]' },
    { who: 'player', text: '[Dowódca: wzywa wsparcie z Ziemi.]' },
    { who: 'admiral', text: '[Admirał: grupa wsparcia startuje. Wytrzymajcie do jej przylotu.]' }
  ],
  wave1Down: [
    { who: 'xo', text: '[Pierwsza fala rozbita. To był zwiad — ciężkie okręty dopiero idą.]' }
  ],
  // Fala 2: pancerniki z flanki.
  wave2: [
    { who: 'xo', text: '[Druga fala z flanki — pancerniki! Tarcze na maksimum.]' }
  ],
  // Wsparcie z Ziemi (w drugiej fali).
  support: [
    { who: 'fleet', text: '[Dowódca grupy wsparcia: wychodzimy z warpa, bierzemy flankę.]' }
  ],
  wave2Down: [
    { who: 'xo', text: '[Druga fala się sypie. Czujniki widzą coś dużego w drodze.]' }
  ],
  // Fala 3 — herszt wraca (uciekł z misji 1).
  bossReturns: [
    { who: 'pirate', text: '[Herszt: myślałeś, że uciekłem? Wróciłem po ciebie.]' },
    { who: 'xo', text: '[To ten sam supercapital — połatany, ale groźny. Celujcie w mostek.]' }
  ],
  // Fala 3 — nowy dowódca (herszt zginął w misji 1).
  newCommander: [
    { who: 'pirate', text: '[Nowy herszt: za mojego poprzednika zapłacisz podwójnie.]' },
    { who: 'xo', text: '[Drugi supercapital! Mostek to jego słaby punkt.]' }
  ],
  bossDown: [
    { who: 'xo', text: '[Okręt herszta wyłączony! Reszta traci głowę.]' }
  ],
  // Piraci się łamią.
  rout: [
    { who: 'pirate', text: '[Herszt: odwrót! Wszyscy odwrót!]' }
  ],
  // Zwycięstwo.
  victory: [
    { who: 'admiral', text: '[Admirał: gratulacje, stocznia zniszczona, odwet odparty.]' },
    { who: 'fleet', text: '[Grupa wsparcia wraca na Ziemię.]' }
  ],
  // Zasadzka w pasie asteroid w drodze powrotnej: piraci wyrywają Atlasa z warpa (zakłócacz).
  ambush: [
    { who: 'xo', text: '[Wypadamy z warpa! Coś nas wyrwało — zakłócacz pola skoku gdzieś w skałach.]' },
    { who: 'ambusher', text: '[Dowódca zasadzki: stocznia była nasza. Z pasa nie wylecicie.]' },
    { who: 'xo', text: '[Dopóki zakłócacz nadaje, nie skoczymy. Trzeba go znaleźć i zdjąć.]' }
  ],
  // Skrzydło zasadzki wychodzi z boku kursu.
  ambushFlank: [
    { who: 'xo', text: '[Kontakty z flanki — wychodzą zza skał!]' }
  ],
  // Zakłócacz zniszczony (albo za daleko) — skok znowu działa.
  jammerDown: [
    { who: 'xo', text: '[Zakłócacz milczy. Napęd skokowy gotowy — możemy lecieć dalej.]' }
  ],
  // Niedobitki zasadzki uciekają w głąb pola.
  ambushRout: [
    { who: 'ambusher', text: '[Dowódca zasadzki: wycofać się w skały! Rozproszyć się!]' }
  ],
  // Zasadzka rozbita albo zostawiona w pasie.
  ambushDown: [
    { who: 'xo', text: '[Pas za nami. Kurs na K-7 przywrócony.]' }
  ],
  // Powrót do doku — zamknięcie rozdziału.
  homecoming: [
    { who: 'k7', text: '[Kontrola K-7: witamy w domu, Atlas. Stanowisko C-01 wolne.]' },
    { who: 'admiral', text: '[Admirał: zasłużony odpoczynek — ale to dopiero początek.]' }
  ],
  // Porażka (Atlas zniszczony).
  defeat: [
    { who: 'xo', text: '[Tracimy okręt!]' }
  ]
});
