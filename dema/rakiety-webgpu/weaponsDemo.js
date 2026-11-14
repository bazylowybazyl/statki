// dema/rakiety-webgpu/weaponsDemo.js
//
// Karty broni, które istnieją TYLKO w demie (jeszcze nie ma ich w src/data/weapons.js). Układ pól jak
// w MASTER_WEAPONS gry — przy wpięciu do gry kartę przenosi się tam bez przepisywania. Nowe pola (lot
// i trafienie liczy na razie tylko demo — flight.js, effects.js):
//   sprint      — człon sprintu: { range — odległość od celu, od której odpala [j.], speed [j./s],
//                 accel [j./s²], turnRate [°/s] w sprincie, align — największy błąd kursu przy starcie [°] };
//   penetration — głowica przebija poszycie: { depth — droga w kadłubie [j.], delay — zwłoka wybuchu [s] }.
// Liczby rozgrywki (obrażenia, zasięg, magazynek) to PROPOZYCJA do strojenia w grze — demo ich nie używa.

export const DEMO_WEAPONS = Object.freeze({
  // NISZCZYCIEL (2026-11-10, użytkownik: „Supernowa będzie do niszczenia tarcz, w salwach ją wypuszczam;
  // teraz jedna, potężna”): JEDNA ciężka rakieta przeciw kadłubowi. Wolna i łatwa do zestrzelenia
  // w przelocie (człon startowy, gruba smuga), ostatnie ~2 km pokonuje sprintem szybszym niż każda inna
  // rakieta, przebija poszycie i wybucha w środku okrętu.
  niszczyciel_missile: Object.freeze({
    id: 'niszczyciel_missile', name: 'Niszczyciel', mountType: 'special_missile', category: 'rocket', size: 'Capital',
    baseDamage: 45000, baseRange: 9000, baseSpeed: 1300, cooldown: 20, ammo: 2,
    burstCount: 1,
    turnRate: 150, homingDelay: 0.25, explosionRadius: 520, vfxColor: '#ff6a2a',
    recoil: 14, shake: 7,
    bodyScale: 3.0,
    proximityRadius: 90, terminalRadius: 700, reacquireRadius: 1400,
    reacquireTurnMultiplier: 1.6, reacquireSpeedFactor: 0.95, terminalSpeedFactor: 1.0,
    leadHorizon: 0.9, terminalLeadHorizon: 0.5,
    rocketVfx: 'niszczyciel',
    // Wyrzut: pionowo z komory, długi zawis (ciężka rakieta rusza dopiero po zapłonie), powolny przechył.
    launchElevation: 90, ejectSpeed: 430, ignitionDelay: 0.8, boostAccel: 760, launchTurnRate: 95,
    dispersal: 0, dispersalTime: 0.55, cruiseAltitude: 230, cellSpacing: 16, launchPorts: 1,
    sprint: Object.freeze({ range: 2200, speed: 4600, accel: 9000, turnRate: 110, align: 12 }),
    penetration: Object.freeze({ depth: 170, delay: 0.16 }),
    description: 'Jedna ciężka rakieta przeciwokrętowa. Zimny wyrzut i człon startowy, a ostatnie dwa kilometry sprintem: przebija poszycie i wybucha w środku kadłuba.'
  })
});
