// Katalog chipów okrętowych — moduły montowane PER KADŁUB w zakładce „Chipy”
// warsztatu (MECHANIC). Chip nie podbija liczb, tylko zmienia regułę działania
// systemu okrętu. Katalog jest rozszerzalny: nowy chip = nowy wpis tutaj
// + miejsce w grze, które pyta o niego przez `hasShipChip(entity, id)`.
//
// Pola wpisu:
//   id   — klucz zapisu (`PLAYER.hullChips[hullId]` w localStorage 'loadout')
//   name — etykieta w UI
//   desc — opis w UI; musi mówić, co się dzieje BEZ chipa
//   cost — cena instalacji w CR

export const PD_CHIP_ID = 'pd_targeting';

export const CHIPS = Object.freeze({
  [PD_CHIP_ID]: Object.freeze({
    id: PD_CHIP_ID,
    name: 'PD CHIP',
    desc: 'Odblokowuje ostrzał kadłubów przez obronę punktową (CIWS, laser PD, flak). '
      + 'Bez chipa PD strzela WYŁĄCZNIE do rakiet, torped i myśliwców — w kadłuby nie celuje. '
      + 'Z chipem kadłuby zawsze mają niższy priorytet niż rakiety i myśliwce.',
    cost: 900
  })
});

// Kolejność na liście w UI.
export const CHIP_ORDER = Object.freeze([PD_CHIP_ID]);

// Zdjęcie chipa zwraca część ceny — chip można przenieść na inny kadłub,
// ale nie za darmo.
export const CHIP_REMOVE_REFUND = 0.5;

export function getChipDef(chipId) {
  return (typeof chipId === 'string' && CHIPS[chipId]) || null;
}
