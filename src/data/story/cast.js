// ============================================================
// Obsada fabuły — kto mówi w dialogach. MIEJSCE NA FABUŁĘ: imiona, stopnie i portrety do uzupełnienia.
//
//   portrait: null  → zastępczy portret (sylwetka z inicjałami w barwie postaci);
//   portrait: 'assets/portraits/admiral.png' → obraz (kwadrat, najlepiej 512×512, twarz w środku kadru).
// Kwestia dialogu może nadpisać portret polem `portrait` (np. inna mina: 'assets/portraits/admiral_angry.png').
// `side` — strona okna dialogu: 'left' (swoi) | 'right' (wrogowie, obcy).
// ============================================================

export const STORY_CAST = Object.freeze({
  player: Object.freeze({
    name: 'Dowódca Atlasa',
    role: 'Okręt flagowy TNS Atlas',
    initials: 'DA',
    color: '#8fd3ff',
    portrait: null,
    side: 'left'
  }),
  xo: Object.freeze({
    name: 'Pierwszy oficer',
    role: 'Mostek Atlasa',
    initials: 'XO',
    color: '#9fe6c8',
    portrait: null,
    side: 'left'
  }),
  admiral: Object.freeze({
    name: 'Admirał',
    role: 'Dowództwo Floty Terra Nova',
    initials: 'AD',
    color: '#ffd27a',
    portrait: null,
    side: 'left'
  }),
  k7: Object.freeze({
    name: 'Kontrola K-7',
    role: 'Port wojskowy Ziemi',
    initials: 'K7',
    color: '#b8c6d8',
    portrait: null,
    side: 'left'
  }),
  intel: Object.freeze({
    name: 'Oficer wywiadu',
    role: 'Wywiad floty',
    initials: 'WY',
    color: '#c9a6ff',
    portrait: null,
    side: 'left'
  }),
  fleet: Object.freeze({
    name: 'Dowódca grupy wsparcia',
    role: 'Grupa bojowa Terra Nova',
    initials: 'GW',
    color: '#7fd1ff',
    portrait: null,
    side: 'left'
  }),
  pirate: Object.freeze({
    name: 'Herszt piratów',
    role: 'Stocznia piracka',
    initials: 'HP',
    color: '#ff7a6b',
    portrait: null,
    side: 'right'
  }),
  // Misja 2: zasadzka w pasie asteroid w drodze powrotnej (herszt mógł już zginąć w trzeciej fali).
  ambusher: Object.freeze({
    name: 'Dowódca zasadzki',
    role: 'Piraci Iron Skull',
    initials: 'DZ',
    color: '#ff9a6b',
    portrait: null,
    side: 'right'
  }),
  unknown: Object.freeze({
    name: '???',
    role: '',
    initials: '?',
    color: '#9aa4b2',
    portrait: null,
    side: 'left'
  })
});

export function castMember(who) {
  return STORY_CAST[who] || STORY_CAST.unknown;
}
