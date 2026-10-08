// src/data/weapons.js
import {
  FIGHTER_SQUADRON_DEFS,
  getDefaultFighterSquadronId
} from './fighterSquadrons.js';

/**
 * MASTER_WEAPONS - Ustandaryzowana baza uzbrojenia HULLFALL
 * * Parametry:
 * - mountType: 'main', 'aux', 'missile', 'hangar', 'special', 'special_missile', 'builtin' (gdzie można zamontować)
 * - category: 'rail', 'beam', 'plasma', 'autocannon', 'rocket', 'ciws', 'flak', 'superweapon' (dla renderera)
 * - size: 'S', 'M', 'L', 'Capital' (wymagany rozmiar hardpointu)
 * - baseRange: Twardy zasięg w jednostkach silnika (silnik sam wyliczy life pocisku: range/speed)
 * - cooldown: Czas między strzałami w sekundach
 *
 * ZASIĘGI (2026-10-07, user: „bronie mają za duży zasięg — zdecydowanie”; do tej daty 3–5× dalej,
 * Yamato 20 km, Mjolnir 100 km — ogień zza kadru, a fregata schodziła z toru o kilometry, zanim
 * pocisk doleciał): pocisk leci do końca zasięgu 0,3–1,4 s, a bateria główna Atlasa mieści się w
 * domyślnym kadrze (9 × 5 km — kadłub = 20% szerokości) w kierunku celowania. Pasma:
 *   obrona punktowa 1–2,2 km, flak do 5,2 km (bez zmian — liczy się od prędkości rakiet)
 *   bliski 1,8–4,5 km — działka, wiązki, armata, Goliath, Plasma Gatling
 *   linia 3–4,5 km — Tempest S / M, Helios S / M
 *   daleki 6–7 km — Tempest L, Helios Lance, Yamato L / Capital
 *   snajper (klasa `weaponClass: 'sniper'`, niżej) — Lanca 8 / 10 km (main M / L), Valkyrie 6,5 / 7 / 9 km
 *     (special S / M / Capital), Mjolnir 20 km (postój i ładowanie)
 *   Hexlance 15 km, rakiety 4,5–15 km, torpedy 7–9 km
 * Wzrok Atlasa (18 km, fogOfWar.js) sięga dalej niż jego działa. Nowa broń — w pasmo swojej roli;
 * w tym samym rozmiarze dłuższy zasięg = mniej DPS (wiązka trafia natychmiast — krótsza).
 *
 * KLASA DZIAŁ SNAJPERSKICH (2026-10-08, decyzja D3, docs/PLAN-fitowanie.md § 4.3.1): pole
 * `weaponClass: 'sniper'` — broń, której jedyną zaletą jest zasięg: mało DPS, duża pojedyncza
 * salwa, szybki pocisk, czasem ładowanie (Lanca M / L, Valkyrie S / M / Capital, Mjolnir). To NIE
 * jest `category` — kategoria steruje efektami, kraterami i ekonomią (Lanca zostaje `rail`). Klasę
 * czytają strażnik (tests/weaponSniperClass.test.mjs), a w dalszych etapach planu komputer
 * balistyczny (zasięg ×1,5 tylko tej klasie, sufit 18 km), pasmo „SNAJPER” w UI i automat kart.
 * Reguły klasy: zasięg ≥ 6,5 km, pocisk do końca zasięgu ≤ 1,4 s, DPS niższy niż u najdalej
 * sięgającej broni zwykłej tego samego gniazda i rozmiaru (dłuższy zasięg = mniej DPS).
 *
 * Mechanika z dema bronie-webgpu (zadanie 18, docs/webgpu/PROJEKT-BRONI.md §2.3–2.6, §5) —
 * pola dopisane w 18-A, czytane od 18-B / 18-D (src/game/projectileMechanics.js,
 * src/game/weaponCharge.js, src/game/weaponFeel.js):
 * - penetration: ile kadłubów pocisk może trafić (N-ty go zatrzymuje) — to samo pole co dawniej
 * - penDepth: budżet materiału przebicia [j.] (Infinity = bez limitu); brak = broń nie przebija
 * - penSpeedLoss: hamowanie w materiale, v·exp(−penSpeedLoss·6·t)
 * - ricochet: { cosMax, chance, hullFrac } — rykoszet przy kącie padania ponad acos(cosMax)
 *   od normalnej z szansą `chance` (hash numeru pocisku, nie losowanie); kadłub dostaje
 *   `hullFrac` obrażeń
 * - chargeTime: ładowanie przed strzałem [s]; requiresStationary: ładowanie tylko na postoju
 * - recoil / shake: odrzut lufy wieżyczki i wstrząs kamery od strzału — JEDYNE źródło (18-D:
 *   Turret2D i Hexlance czytają je stąd; dawna tabela FX_PROFILE w src/vfx/turret2D.js ma
 *   już tylko klucze wieżyczek), liczby = dawne FX_PROFILE, warianty S/L jak w demie
 * - impactScale: mnożnik rozmiaru efektu w bramce LOD trafienia i wstrząsu przy trafieniu
 *   (18-D; obraz receptury bez zmian), brak = 1
 */

export const MASTER_WEAPONS = {
  // ==========================================================================
  // BRONIE GŁÓWNE GRACZA (Main)
  // ==========================================================================
  railgun_mk1: {
    id: 'railgun_mk1', name: 'Tempest Ion Mk I', mountType: 'main', category: 'rail', size: 'M',
    // 2026-10-07: obrażenia 8 → 12 (8 → 12 DPS) — było najsłabsze działo w grze, słabsze od broni S.
    baseDamage: 12, baseRange: 4000, baseSpeed: 7000, cooldown: 1.0, spread: 0.02,
    penetration: 1, energyCost: 6, vfxColor: '#00ccff',
    recoil: 4, shake: 2.5,
    barrelsPerShot: 1, model3D: 'tempest_ion', render3dOnly: true
  },
  railgun_mk2: {
    id: 'railgun_mk2', name: 'Tempest Ion Mk II', mountType: 'main', category: 'rail', size: 'M',
    baseDamage: 10, baseRange: 4500, baseSpeed: 8000, cooldown: 0.8, spread: 0.018,
    penetration: 2, energyCost: 8, vfxColor: '#55deff',
    recoil: 4, shake: 2.5,
    barrelsPerShot: 2, model3D: 'tempest_ion', render3dOnly: true
  },
  vulcan_minigun: {
    id: 'vulcan_minigun', name: 'Vulcan Minigun', mountType: 'main', category: 'autocannon', size: 'M',
    baseDamage: 4, baseRange: 2200, baseSpeed: 4000, cooldown: 0.07, spread: 0.04,
    penetration: 0, energyCost: 5, vfxColor: '#ffaa00',
    recoil: 3, shake: 2,
    ricochet: { cosMax: 0.42, chance: 0.6, hullFrac: 0.3 },
    model3D: 'vulcan_minigun', render3dOnly: true
  },
  helios_laser: {
    id: 'helios_laser', name: 'Helios Laser', mountType: 'main', category: 'plasma', size: 'M',
    baseDamage: 12, baseRange: 4200, baseSpeed: 10000, cooldown: 0.55, spread: 0.01,
    penetration: 1, energyCost: 7, vfxColor: '#ff003c',
    recoil: 6, shake: 3,
    model3D: 'helios_laser', render3dOnly: true
  },
  heavy_autocannon: {
    id: 'heavy_autocannon', name: 'Heavy Autocannon', mountType: 'main', category: 'autocannon', size: 'M',
    baseDamage: 28, baseRange: 2800, baseSpeed: 3000, cooldown: 0.5, spread: 0.04,
    penetration: 1, energyCost: 5, vfxColor: '#ffcc8a',
    recoil: 8, shake: 4
  },
  armata_mk1: {
    id: 'armata_mk1', name: 'Armata Oblężnicza', mountType: 'main', category: 'armata', size: 'L',
    baseDamage: 150, baseRange: 3500, baseSpeed: 2500, cooldown: 2.5, spread: 0.005,
    explodeRadius: 140, energyCost: 14, vfxColor: '#ff5500',
    // recoil / shake z FX_PROFILE (było 15 / 8 — nieczytane; decyzja §5 p. 5)
    recoil: 12, shake: 6.5, impactScale: 1.0, barrelsPerShot: 1,
    model3D: 'armata_mk1', render3dOnly: true
  },
  beam_continuous: {
    id: 'beam_continuous', name: 'Laser Wiązkowy (Ciągły)', mountType: 'main', category: 'beam', size: 'M',
    // 2026-10-07: obrażenia 8 → 5 (~70 DPS z przerwami) — trafia natychmiast, a miała 2× DPS działek.
    baseDamage: 5, baseRange: 2500, baseSpeed: Infinity, cooldown: 0.05, spread: 0.0, duration: 0.06,
    penetration: 0, energyCost: 8, vfxColor: '#00ffcc',
    recoil: 1, shake: 1.5, impactScale: 0.4, beamMode: 'continuous', barrelsPerShot: 1,
    beamOnTime: 2.6, beamOffTime: 1.1,
    model3D: 'beam_continuous', render3dOnly: true
  },
  beam_pulse: {
    id: 'beam_pulse', name: 'Laser Wiązkowy (Puls)', mountType: 'main', category: 'beam', size: 'M',
    baseDamage: 45, baseRange: 3500, baseSpeed: Infinity, cooldown: 0.65, spread: 0.002, duration: 0.15,
    penetration: 1, energyCost: 10, vfxColor: '#ff003c',
    recoil: 6, shake: 3.5, impactScale: 0.7, beamMode: 'pulse', barrelsPerShot: 1,
    model3D: 'beam_pulse', render3dOnly: true
  },

  // ==========================================================================
  // WARIANTY ROZMIAROWE BRONI GŁÓWNEJ (S / M / L)
  // Te same rodziny broni w trzech klasach hardpointu. S mieści się na fregacie,
  // M od niszczyciela, L od pancernika. Renderer dobiera model/pocisk po nazwie.
  // ==========================================================================
  // --- Tempest Ion (rail) ---  (M = railgun_mk1 / railgun_mk2)
  tempest_ion_s: {
    id: 'tempest_ion_s', name: 'Tempest Ion — Lekki', mountType: 'main', category: 'rail', size: 'S',
    // 2026-10-07: obrażenia 5 → 8 (7 → 11 DPS) — po skróceniu zasięgów przewaga zasięgu nad działkami
    // spadła do ~1,6×, więc 7× mniej DPS przestało się bronić.
    baseDamage: 8, baseRange: 3000, baseSpeed: 7500, cooldown: 0.7, spread: 0.024,
    penetration: 1, energyCost: 4, vfxColor: '#7fe8ff',
    recoil: 4, shake: 2.5,
    barrelsPerShot: 1, model3D: 'tempest_ion', render3dOnly: true
  },
  tempest_ion_l: {
    id: 'tempest_ion_l', name: 'Tempest Ion — Ciężki', mountType: 'main', category: 'rail', size: 'L',
    // 2026-10-07: 24 obr. / 1,4 s (17 DPS) → 36 / 1,0 s (36 DPS) — był słabszy od Tempesta M (25 DPS).
    baseDamage: 36, baseRange: 6000, baseSpeed: 9000, cooldown: 1.0, spread: 0.011,
    penetration: 3, energyCost: 14, vfxColor: '#33b5ff',
    recoil: 4, shake: 2.5,
    barrelsPerShot: 1, model3D: 'tempest_ion', render3dOnly: true
  },
  // --- Helios (plasma / laser) ---  (M = helios_laser)
  helios_laser_s: {
    id: 'helios_laser_s', name: 'Helios Laser — Lekki', mountType: 'main', category: 'plasma', size: 'S',
    baseDamage: 7, baseRange: 3200, baseSpeed: 11000, cooldown: 0.45, spread: 0.012,
    penetration: 1, energyCost: 5, vfxColor: '#ff5a7a',
    recoil: 6, shake: 3,
    model3D: 'helios_laser', render3dOnly: true
  },
  helios_lance_l: {
    id: 'helios_lance_l', name: 'Helios Lance — Ciężki', mountType: 'main', category: 'plasma', size: 'L',
    baseDamage: 30, baseRange: 6000, baseSpeed: 10000, cooldown: 0.8, spread: 0.008,
    penetration: 2, energyCost: 12, vfxColor: '#ff2a52',
    recoil: 6, shake: 3,
    model3D: 'helios_laser', render3dOnly: true
  },
  // --- Autocannon (Vulcan / Heavy) ---  (M = vulcan_minigun / heavy_autocannon)
  gatling_s: {
    id: 'gatling_s', name: 'Gatling — Lekki', mountType: 'main', category: 'autocannon', size: 'S',
    // 2026-10-07: przeładowanie 0,06 → 0,09 s (50 → 33 DPS) — broń S strzelała jak działka M.
    baseDamage: 3, baseRange: 1800, baseSpeed: 4200, cooldown: 0.09, spread: 0.05,
    penetration: 0, energyCost: 3, vfxColor: '#ffcf99',
    recoil: 3, shake: 2,
    ricochet: { cosMax: 0.42, chance: 0.6, hullFrac: 0.3 },
    model3D: 'vulcan_minigun', render3dOnly: true
  },
  heavy_autocannon_l: {
    id: 'heavy_autocannon_l', name: 'Heavy Autocannon — Oblężniczy', mountType: 'main', category: 'autocannon', size: 'L',
    baseDamage: 60, baseRange: 3600, baseSpeed: 3200, cooldown: 0.7, spread: 0.03,
    penetration: 2, energyCost: 9, vfxColor: '#ffb066',
    recoil: 8, shake: 4,
    model3D: 'heavy_autocannon', render3dOnly: true
  },
  // --- Lanca (rail, klasa snajperska — § KLASA DZIAŁ SNAJPERSKICH; 2026-10-08, D10 planu fitowania) ---
  // Działo main dalekiego zasięgu: mniej DPS niż Tempest tego rozmiaru za ~2× dłuższy zasięg, szybki pocisk,
  // płytkie przebicie jak u Valkyrie (cienkie części na wylot, w grubszym kadłubie zakleszczenie). Obraz:
  // receptura Valkyrie (WEAPON_FX), wieża Tempesta z długą lufą (Turret2D SPECS.lance, rodzina 3D `lance`),
  // rana i krater — wpisy lanceM / lanceL (src/3d/hullDamageStamps.js).
  lance_rail_m: {
    id: 'lance_rail_m', name: 'Lanca', mountType: 'main', category: 'rail', size: 'M', weaponClass: 'sniper',
    baseDamage: 48, baseRange: 8000, baseSpeed: 14000, cooldown: 2.4, spread: 0.002,
    penetration: 2, energyCost: 10, vfxColor: '#ff00ff',
    penDepth: 40, penSpeedLoss: 0.35,
    recoil: 12, shake: 7, impactScale: 1.0,
    model3D: 'lance_rail', render3dOnly: true
  },
  lance_rail_l: {
    id: 'lance_rail_l', name: 'Lanca Ciężka', mountType: 'main', category: 'rail', size: 'L', weaponClass: 'sniper',
    baseDamage: 100, baseRange: 10000, baseSpeed: 15000, cooldown: 4.0, spread: 0.0015,
    penetration: 2, energyCost: 18, vfxColor: '#ff00ff',
    penDepth: 60, penSpeedLoss: 0.35,
    recoil: 16, shake: 9, impactScale: 1.2,
    model3D: 'lance_rail', render3dOnly: true
  },

  // ==========================================================================
  // OBRONA PUNKTOWA GRACZA (Aux)
  // ==========================================================================
  ciws_mk1: { 
    id: 'ciws_mk1', name: 'CIWS Mk I', mountType: 'aux', category: 'ciws', size: 'S',
    baseDamage: 12, baseRange: 1500, baseSpeed: 2000, cooldown: 0.06, spread: 0.10,
    energyCost: 2, vfxColor: '#8cffd0',
    recoil: 1.5, shake: 1
  },
  laser_pd_mk1: {
    id: 'laser_pd_mk1', name: 'Helios PD Laser', mountType: 'aux', category: 'beam', size: 'S',
    baseDamage: 16, baseRange: 1000, baseSpeed: Infinity, cooldown: 0.18, duration: 0.09, spread: 0.0,
    energyCost: 3, vfxColor: 'rgba(110,200,255,0.9)',
    recoil: 0.5, shake: 0.3
  },
  ciws_mk2: {
    id: 'ciws_mk2', name: 'CIWS Mk II', mountType: 'aux', category: 'ciws', size: 'M',
    baseDamage: 18, baseRange: 2200, baseSpeed: 2400, cooldown: 0.05, spread: 0.09,
    energyCost: 3, vfxColor: '#8cffd0',
    recoil: 1.5, shake: 1
  },

  // --------------------------------------------------------------------------
  // FLAK — zapora przeciwlotnicza (aux)
  // --------------------------------------------------------------------------
  // Trzecia rodzina PD obok CIWS i lasera. Nie trafia w cel: pocisk pęka
  // w powietrzu w punkcie wyprzedzenia i sieje odłamkami po całej kuli
  // `flakBurstRadius`. Liczy się objętość ognia, nie celność.
  //
  // Pola specyficzne (obsługa: src/game/flakSystem.js):
  //   flakBurstRadius — promień rażenia odłamkami [u]
  //   flakFuseRadius  — zasięg zapalnika zbliżeniowego [u]
  //   flakFalloff     — ułamek obrażeń na krawędzi kuli (0..1)
  //   flakHullFactor  — mnożnik obrażeń vs kadłuby okrętów (flak jest plot.)
  //   burstCount      — ile pocisków leci w jednej salwie (ściana pęknięć)
  //
  // Skala kill: myśliwiec ma 80-150 HP i promień 12 u, eskadra 9 maszyn
  // rozciąga się na ~250-400 u. Dlatego S gasi pojedynczą maszynę,
  // a Capital wycina cały klin jednym pęknięciem.
  flak_s: {
    id: 'flak_s', name: 'Kartacz Flak — Lekki', mountType: 'aux', category: 'flak', size: 'S',
    baseDamage: 110, baseRange: 1900, baseSpeed: 1500, cooldown: 0.85, spread: 0.05,
    energyCost: 3, vfxColor: '#ffcf6b',
    flakBurstRadius: 95, flakFuseRadius: 34, flakFalloff: 0.35, flakHullFactor: 0.10,
    burstCount: 1, recoil: 3.5, shake: 1.8,
    description: 'Lekka zapora burtowa. Kopuła rażenia ~40 u: gasi przechwytywacz, cięższy myśliwiec tylko obrywa.'
  },
  flak_m: {
    id: 'flak_m', name: 'Kartacz Flak — Średni', mountType: 'aux', category: 'flak', size: 'M',
    baseDamage: 200, baseRange: 2600, baseSpeed: 1650, cooldown: 1.0, spread: 0.07,
    energyCost: 5, vfxColor: '#ffc258',
    flakBurstRadius: 170, flakFuseRadius: 46, flakFalloff: 0.35, flakHullFactor: 0.12,
    burstCount: 2, recoil: 5, shake: 2.6,
    description: 'Dwupociskowa salwa. Rozbija parę myśliwców naraz i rozprasza szyk podejścia.'
  },
  flak_l: {
    id: 'flak_l', name: 'Grad Flak — Ciężki', mountType: 'aux', category: 'flak', size: 'L',
    baseDamage: 300, baseRange: 3600, baseSpeed: 1800, cooldown: 1.3, spread: 0.10,
    energyCost: 8, vfxColor: '#ffb347',
    flakBurstRadius: 270, flakFuseRadius: 62, flakFalloff: 0.35, flakHullFactor: 0.14,
    burstCount: 3, recoil: 8, shake: 4.2,
    description: 'Trzy pęknięcia na salwę. Kasuje cały klucz myśliwców i strąca nadlatujące rakiety.'
  },
  flak_capital: {
    id: 'flak_capital', name: 'Zapora Flak "Perun"', mountType: 'aux', category: 'flak', size: 'Capital',
    baseDamage: 460, baseRange: 5200, baseSpeed: 1900, cooldown: 1.9, spread: 0.16,
    energyCost: 14, vfxColor: '#ffa726',
    flakBurstRadius: 480, flakFuseRadius: 92, flakFalloff: 0.35, flakHullFactor: 0.16,
    burstCount: 5, recoil: 14, shake: 7.5,
    description: 'Ściana pięciu pęknięć po pół kilometra każde. Jedna salwa wymiata całą nadlatującą eskadrę.'
  },

  // ==========================================================================
  // RAKIETY
  // Lot: src/effects3d/rocketSystem3D.js — zimny wyrzut z komory (rakieta wyskakuje nad
  // kadłub i na chwilę zawisa), zapłon, przechył w kurs wachlarza salwy, potem naprowadzanie
  // na cel z kluczeniem i zejście na płaszczyznę gry. Wysokość jest tylko obrazem (kamery 3D,
  // światło, skrót perspektywy) — trafienia liczą się w 2D. Pola rakiet poza wspólnymi:
  //   burstCount / burstDelay — SALWA: rakiet na jedno naciśnięcie i odstęp między nimi [s]
  //     (ripple z kolejnych komór wyrzutni). Amunicja zaczepu (`ammo`) liczy SALWY.
  //   launchElevation — kąt wyrzutu nad płaszczyzną gry [°] (90 = pionowo, VLS)
  //   ejectSpeed [j./s], ignitionDelay [s] — zimny wyrzut i chwila zapłonu (zawis)
  //   boostAccel — przyspieszenie silnika [j./s²]
  //   launchTurnRate — obrót przy przechyle po zapłonie [°/s]
  //   dispersal — połowa wachlarza salwy [°], dispersalTime — jak długo po zapłonie rakieta
  //     trzyma kurs wachlarza [s] (rakiety rozkwitają, potem zbiegają na cel)
  //   weave / weaveHz — kluczenie w locie [°, Hz] (gaśnie w fazie końcowej)
  //   cruiseAltitude — wysokość przelotu nad płaszczyzną [j.] (obraz)
  //   cellSpacing [j.] / launchPorts — rozstaw i liczba komór w rzędzie (skąd wychodzą rakiety salwy)
  //   rocketVfx — wygląd (src/3d/rockets/palette.js): cruise | fast | supernova | micro | hydra
  //   ordnancePerMissile — ile sztuk `missile_round` zjada JEDNA rakieta (mikrorakiety: ułamek)
  //   submunition — głowica kasetowa (Hydra): { count, splitRange, …pola rakiety potomnej };
  //     baseDamage broni kasetowej = obrażenia JEDNEJ głowicy potomnej
  // ==========================================================================
  missile_rack: {
    id: 'missile_rack', name: 'Cruise Missile Rack', mountType: 'missile', category: 'rocket', size: 'M',
    baseDamage: 1000, baseRange: 12000, baseSpeed: 1800, cooldown: 7.5, ammo: 8,
    burstCount: 3, burstDelay: 0.16,
    turnRate: 900, homingDelay: 0.2, explosionRadius: 72, vfxColor: '#ffbb77',
    recoil: 4, shake: 2,
    rocketVfx: 'cruise',
    launchElevation: 74, ejectSpeed: 520, ignitionDelay: 0.3, boostAccel: 2000, launchTurnRate: 260,
    dispersal: 40, dispersalTime: 0.45, weave: 3, weaveHz: 1.1, cruiseAltitude: 95,
    cellSpacing: 7, launchPorts: 3,
    description: 'Salwa trzech ciężkich pocisków manewrujących: zimny wyrzut, zapłon nad pokładem, szeroki łuk na cel.'
  },
  fast_missile_rack: {
    id: 'fast_missile_rack', name: 'Fast Missile Rack', mountType: 'missile', category: 'rocket', size: 'S',
    baseDamage: 700, baseRange: 6000, baseSpeed: 3200, cooldown: 6.0, ammo: 8,
    burstCount: 4, burstDelay: 0.09,
    turnRate: 1560, homingDelay: 0.08, explosionRadius: 42, vfxColor: '#ffd27a',
    recoil: 3, shake: 1.5,
    bodyScale: 0.56, exhaustScale: 0.6, fireScale: 0.58, smokeScale: 0.55, explosionVisualScale: 0.72,
    proximityRadius: 58, terminalRadius: 150, reacquireRadius: 420,
    reacquireTurnMultiplier: 2.75, reacquireSpeedFactor: 0.5, terminalSpeedFactor: 0.62,
    leadHorizon: 0.3, terminalLeadHorizon: 0.04,
    rocketVfx: 'fast',
    launchElevation: 64, ejectSpeed: 380, ignitionDelay: 0.16, boostAccel: 3400, launchTurnRate: 440,
    dispersal: 42, dispersalTime: 0.3, weave: 5, weaveHz: 2.2, cruiseAltitude: 60,
    cellSpacing: 5, launchPorts: 3,
    description: 'Short-range high-agility missile rack. Four fast missiles per trigger, built for nimble targets.'
  },
  roj_pod: {
    id: 'roj_pod', name: 'Rój — Kaseta Mikrorakiet', mountType: 'missile', category: 'rocket', size: 'S',
    baseDamage: 170, baseRange: 4500, baseSpeed: 2600, cooldown: 3.4, ammo: 16,
    burstCount: 8, burstDelay: 0.05,
    turnRate: 600, homingDelay: 0, explosionRadius: 34, vfxColor: '#9fe6ff',
    recoil: 1.5, shake: 0.8,
    bodyScale: 0.36, rocketVfx: 'micro',
    proximityRadius: 50, terminalRadius: 170, reacquireRadius: 520,
    reacquireTurnMultiplier: 2.4, reacquireSpeedFactor: 0.55, terminalSpeedFactor: 0.72,
    leadHorizon: 0.4, terminalLeadHorizon: 0.06,
    launchElevation: 70, ejectSpeed: 320, ignitionDelay: 0.1, boostAccel: 4400, launchTurnRate: 620,
    dispersal: 50, dispersalTime: 0.26, weave: 14, weaveHz: 2.4, cruiseAltitude: 45,
    cellSpacing: 3.2, launchPorts: 4, ordnancePerMissile: 0.2,
    description: 'Osiem mikrorakiet na jedno naciśnięcie. Rozchodzą się wachlarzem i zbiegają na cel z kilku stron.'
  },
  grad_launcher: {
    id: 'grad_launcher', name: 'Grad — Wyrzutnia Salwowa', mountType: 'missile', category: 'rocket', size: 'L',
    baseDamage: 180, baseRange: 6000, baseSpeed: 2300, cooldown: 9.0, ammo: 8,
    burstCount: 24, burstDelay: 0.034,
    turnRate: 520, homingDelay: 0, explosionRadius: 40, vfxColor: '#ffc38a',
    recoil: 2, shake: 1.2,
    bodyScale: 0.4, rocketVfx: 'micro',
    proximityRadius: 52, terminalRadius: 190, reacquireRadius: 560,
    reacquireTurnMultiplier: 2.4, reacquireSpeedFactor: 0.55, terminalSpeedFactor: 0.72,
    leadHorizon: 0.45, terminalLeadHorizon: 0.06,
    launchElevation: 84, ejectSpeed: 400, ignitionDelay: 0.13, boostAccel: 3800, launchTurnRate: 560,
    dispersal: 78, dispersalTime: 0.34, weave: 18, weaveHz: 1.9, cruiseAltitude: 55,
    cellSpacing: 4, launchPorts: 6, ordnancePerMissile: 0.2,
    description: 'Grad: 24 mikrorakiety w jednej salwie. Wyskakują z komór, rozkwitają wachlarzem i spadają na cel ze wszystkich stron. Pojedyncza głowica słaba — liczy się masa ognia.'
  },
  hydra_mirv: {
    id: 'hydra_mirv', name: 'Hydra — Rakieta Kasetowa', mountType: 'missile', category: 'rocket', size: 'M',
    baseDamage: 240, baseRange: 9000, baseSpeed: 2000, cooldown: 7.0, ammo: 10,
    burstCount: 2, burstDelay: 0.24,
    turnRate: 700, homingDelay: 0, explosionRadius: 60, vfxColor: '#ffb070',
    recoil: 4, shake: 2,
    bodyScale: 0.95, rocketVfx: 'hydra',
    launchElevation: 78, ejectSpeed: 480, ignitionDelay: 0.26, boostAccel: 1900, launchTurnRate: 290,
    dispersal: 18, dispersalTime: 0.3, weave: 2, weaveHz: 1.2, cruiseAltitude: 110,
    cellSpacing: 8, launchPorts: 2,
    submunition: {
      count: 6, splitRange: 1700,
      baseSpeed: 2600, turnRate: 640, explosionRadius: 36, bodyScale: 0.36, rocketVfx: 'micro',
      boostAccel: 5200, launchTurnRate: 760, dispersal: 58, dispersalTime: 0.16, weave: 12, weaveHz: 2.2,
      cruiseAltitude: 40, proximityRadius: 50, terminalRadius: 170, reacquireRadius: 520,
      reacquireTurnMultiplier: 2.4, reacquireSpeedFactor: 0.55, terminalSpeedFactor: 0.72,
      leadHorizon: 0.35, terminalLeadHorizon: 0.05
    },
    description: 'Nosiciel leci na cel i ~1,7 km przed nim pęka na sześć mikrorakiet, które obchodzą obronę wachlarzem.'
  },
  osa_micro_missile: {
    id: 'osa_micro_missile', name: 'Osa Mk I', mountType: 'missile', category: 'rocket', size: 'S',
    baseDamage: 280, baseRange: 4000, baseSpeed: 3000, cooldown: 1.0, ammo: 10,
    turnRate: 2400, homingDelay: 0, explosionRadius: 36, vfxColor: '#7ef0ff',
    // Canvas-only render path — bypasses rocketSystem3D entirely.
    // No ejection / quaternion guidance / multi-phase homing. Just simple turn-rate clamp
    // homing on the 2D bullet plane (index.html:15260). Direct, predictable, scalable.
    forceCanvas: true,
    // Override default size→radius mapping (S=2u). Fighter radius is 12u, so fuse=12+8=20u —
    // wide enough that step/frame (3000/60=50u) doesn't tunnel through.
    bulletRadius: 8,
    description: 'Lekka, zwrotna rakieta myśliwska. Krótki zasięg, wysoka kadencja, plazmowy ogon.'
  },
  supernova_missile: {
    // SUPERNOVA BARRAGE (2026-10-05, user: „4 naraz — do niszczenia grup przeciwników”): salwa 4 głowic,
    // każda na inny okręt grupy wokół celu (`barrage`, src/game/barrage.js); id zostaje (zapisane wyposażenie).
    id: 'supernova_missile', name: 'Supernova Barrage', mountType: 'special_missile', category: 'rocket', size: 'Capital',
    // ammo: magazynek = 2 SALWY po 4 (user 2026-10-05: „2 salwy po 4”); rakieta specjalna zużywa go w
    // fireSpecialLoadout (index.html), przy montażu zawsze z karty (stare zapisy miały 8).
    baseDamage: 10000, baseRange: 15000, baseSpeed: 3600, cooldown: 6.0, ammo: 2,
    burstCount: 4, burstDelay: 0.07,
    // radius — promień szukania grupy wokół celu [j.], spacing — najmniejszy odstęp punktów wybuchu
    // (wróg bliżej wybranego punktu i tak stoi w jego fali).
    barrage: { radius: 6000, spacing: 1500 },
    // explosionRadius: promień rażenia (2026-10-05, user: wybuch większy razem z obrazem — było 132).
    turnRate: 980, homingDelay: 0.06, explosionRadius: 1200, vfxColor: '#ff7cf2',
    recoil: 9, shake: 5,
    bodyScale: 1.95, exhaustScale: 1.5, fireScale: 1.6, smokeScale: 1.45, explosionVisualScale: 2.15,
    proximityRadius: 98, terminalRadius: 260, reacquireRadius: 760,
    reacquireTurnMultiplier: 2.9, reacquireSpeedFactor: 0.44, terminalSpeedFactor: 0.58,
    leadHorizon: 0.28, terminalLeadHorizon: 0.03,
    rocketBodyColor: '#ff8de9',
    rocketFireVfx: 'supernova',
    rocketSmokeVfx: 'chemical',
    rocketExplosionVfx: 'supernova',
    rocketVfx: 'supernova',
    // Wyrzut: pionowo, wysoko i z długim zawisem — ciężka głowica rusza dopiero po zapłonie.
    launchElevation: 88, ejectSpeed: 560, ignitionDelay: 0.5, boostAccel: 2600, launchTurnRate: 170,
    dispersal: 14, dispersalTime: 0.42, cruiseAltitude: 150, cellSpacing: 10, launchPorts: 2,
    description: 'Salwa czterech głowic Supernowa: każda rozchodzi się na inny okręt grupy wokół celu (bez wroga obok — wszystkie w cel), cztery wybuchy niemal naraz.'
  },
  // ==========================================================================
  // HANGARY
  // ==========================================================================
  fighter_bay: { 
    id: 'fighter_bay', name: 'Fighter Bay', mountType: 'hangar', category: 'hangar', size: 'L',
    baseDamage: 0, baseRange: 0, baseSpeed: 0, cooldown: 30.0, energyCost: 5,
    squadronId: getDefaultFighterSquadronId(), legacyHangarBay: true
  },
  fighter_squad_interceptor: {
    id: 'fighter_squad_interceptor', name: FIGHTER_SQUADRON_DEFS.interceptor.name,
    mountType: 'hangar', category: 'hangar', size: 'S',
    baseDamage: 0, baseRange: 0, baseSpeed: 0, cooldown: 30.0, energyCost: 5,
    squadronId: 'interceptor', description: FIGHTER_SQUADRON_DEFS.interceptor.role
  },
  fighter_squad_multirole: {
    id: 'fighter_squad_multirole', name: FIGHTER_SQUADRON_DEFS.multirole.name,
    mountType: 'hangar', category: 'hangar', size: 'S',
    baseDamage: 0, baseRange: 0, baseSpeed: 0, cooldown: 30.0, energyCost: 5,
    squadronId: 'multirole', description: FIGHTER_SQUADRON_DEFS.multirole.role
  },
  fighter_squad_strike: {
    id: 'fighter_squad_strike', name: FIGHTER_SQUADRON_DEFS.strike.name,
    mountType: 'hangar', category: 'hangar', size: 'S',
    baseDamage: 0, baseRange: 0, baseSpeed: 0, cooldown: 30.0, energyCost: 5,
    squadronId: 'strike', description: FIGHTER_SQUADRON_DEFS.strike.role
  },

  // ==========================================================================
  // SUPERBRONIE (Special)
  // ==========================================================================
  special_goliath_autocannon: {
    id: 'special_goliath_autocannon', name: 'Goliath Autocannon (Special)', mountType: 'special', category: 'autocannon', size: 'Capital',
    baseDamage: 45, baseRange: 4500, baseSpeed: 3500, cooldown: 0.32, spread: 0.03,
    penetration: 1, energyCost: 18, vfxColor: '#ff6600',
    recoil: 20, shake: 10, impactScale: 1.0,
    model3D: 'special_goliath_autocannon', render3dOnly: true
  },
  special_plasma_gatling: {
    id: 'special_plasma_gatling', name: 'Ion Plasma Gatling (Special)', mountType: 'special', category: 'plasma', size: 'Capital',
    // 2026-10-08 (D4 planu fitowania): obrażenia 60 → 160 (240 → 640 DPS) — bliski tank przegrywał z
    // Yamato (510 DPS na 7 km) nawet z bliska. Obrażenia, nie szybkostrzelność: rodzina bez krateru na
    // miarę rany (budżet HP 0,9 × 160 = 144 < 320 HP węzła — jeden strzał nie wybija dziury), a dziury
    // z serii rosną tak samo jak przy szybszym ogniu o tym samym DPS; obraz i koszt efektów bez zmian.
    baseDamage: 160, baseRange: 3200, baseSpeed: 2000, cooldown: 0.25, spread: 0.05,
    penetration: 1, energyCost: 22, vfxColor: '#00ffff',
    recoil: 15, shake: 8, impactScale: 1.5,
    model3D: 'special_plasma_gatling', render3dOnly: true
  },
  special_valkyrie_railgun: {
    id: 'special_valkyrie_railgun', name: 'Valkyrie Railgun (Special)', mountType: 'special', category: 'rail', size: 'Capital',
    weaponClass: 'sniper',
    baseDamage: 500, baseRange: 9000, baseSpeed: 15000, cooldown: 3.0, spread: 0.001,
    penetration: 3, energyCost: 40, vfxColor: '#ff00ff',
    // Ładowanie 0,28 s jak w demie (§5 p. 4); 260 j. materiału — fregaty i niszczyciele
    // w burtę na wylot, w kapitałach zakleszczenie. recoil / shake z FX_PROFILE (było 60 / 45).
    chargeTime: 0.28, penDepth: 260, penSpeedLoss: 0.35,
    recoil: 20, shake: 12, impactScale: 3.5,
    model3D: 'special_valkyrie_railgun', render3dOnly: true
  },
  special_yamato_cannon: {
    id: 'special_yamato_cannon', name: 'Bateria Główna Klasy YAMATO', mountType: 'special', category: 'plasma', size: 'Capital',
    baseDamage: 850, baseRange: 7000, baseSpeed: 9000, cooldown: 5.0, spread: 0.005,
    penetration: 5, energyCost: 75, vfxColor: '#00ffff',
    // recoil / shake z FX_PROFILE (było 90 / 65 — nieczytane)
    recoil: 60, shake: 20, impactScale: 4.5, barrelsPerShot: 3,
    model3D: 'special_yamato_cannon', render3dOnly: true
  },
  hexlance_siege: {
    id: 'hexlance_siege', name: 'Hexlance Siege Cannon', mountType: 'builtin', category: 'superweapon', size: 'Capital',
    // Zasięg 15 km (2026-10-07, było 60): rząd parkingu suchego doku w misji 1 dalej przecina na wylot.
    baseDamage: 9999, baseRange: 15000, baseSpeed: 12000, cooldown: 6.0, chargeTime: 1.2,
    // Jeden strzał na gniazdo (decyzja 2026-09-29 — seria 4 strzałów z 18-B wycofana); burstDelay = odstęp gniazd.
    burstCount: 1, burstDelay: 0.25, energyCost: 200, vfxColor: '#d0eaff',
    recoil: 0, shake: 14
  },

  // ==========================================================================
  // WARIANTY ROZMIAROWE BRONI SPECJALNEJ (S / M / L)
  // Gniazdo special przyjmuje broń nie większą niż klasa kadłuba (fregata S, niszczyciel M,
  // pancernik / lotniskowiec L), a bronie wyżej są Capital — bez tych wariantów mniejsze kadłuby
  // gracza nie miały czego zamontować (docs/BRIEF-kierowanie-ogniem.md § 6). Rodziny efektów,
  // sprite'y i modele 3D rodziców (Valkyrie, Yamato); stemple ran i kratery — własne, mniejsze
  // wpisy (src/3d/hullDamageStamps.js: valkyrieS / valkyrieM / yamatoL).
  // ==========================================================================
  // --- Valkyrie (rail, ładowanie + przebicie) ---  (Capital = special_valkyrie_railgun)
  special_valkyrie_s: {
    id: 'special_valkyrie_s', name: 'Kolec — Lekki Railgun Osiowy (Special)', mountType: 'special', category: 'rail', size: 'S',
    weaponClass: 'sniper',
    // Zasięg 5 → 6,5 km (2026-10-08, D10): snajper był krótszy niż Yamato L (6 km) z gniazda special.
    baseDamage: 180, baseRange: 6500, baseSpeed: 12000, cooldown: 2.5, spread: 0.002,
    penetration: 2, energyCost: 12, vfxColor: '#ff00ff',
    // 60 j. materiału: płytkie przebicie (cienkie burty na wylot), głębiej zakleszczenie.
    chargeTime: 0.2, penDepth: 60, penSpeedLoss: 0.35,
    recoil: 8, shake: 4, impactScale: 1.2,
    model3D: 'special_valkyrie_railgun', render3dOnly: true
  },
  special_valkyrie_m: {
    id: 'special_valkyrie_m', name: 'Oszczep — Railgun Średni (Special)', mountType: 'special', category: 'rail', size: 'M',
    weaponClass: 'sniper',
    baseDamage: 380, baseRange: 7000, baseSpeed: 13500, cooldown: 3.0, spread: 0.0015,
    penetration: 3, energyCost: 22, vfxColor: '#ff00ff',
    // 140 j. materiału: ma przebijać fregatę w burtę (BRIEF § 6), w większych zakleszczenie.
    chargeTime: 0.25, penDepth: 140, penSpeedLoss: 0.35,
    recoil: 12, shake: 7, impactScale: 2.0,
    model3D: 'special_valkyrie_railgun', render3dOnly: true
  },
  // --- Yamato (plasma) ---  (Capital = special_yamato_cannon, 3 lufy)
  // Dwie lufy na salwę: skrajne lufy wieży rodzica (środkowa kołyska pusta — Turret2D yamatoTwin).
  special_yamato_l: {
    id: 'special_yamato_l', name: 'Bateria Dwulufowa Klasy YAMATO (Special)', mountType: 'special', category: 'plasma', size: 'L',
    baseDamage: 450, baseRange: 6000, baseSpeed: 9000, cooldown: 5.0, spread: 0.005,
    penetration: 3, energyCost: 40, vfxColor: '#00ffff',
    recoil: 34, shake: 12, impactScale: 2.8, barrelsPerShot: 2,
    model3D: 'special_yamato_cannon', render3dOnly: true
  },

  // ==========================================================================
  // SIEGE / LONG-RANGE WEAPONS
  // ==========================================================================
  // Torpedy gracza strzela się z TRYBU TORPED (klawisz 8, jak w World of Warships —
  // src/game/torpedoAim.js): wachlarz `burstCount` NIEKIEROWANYCH torped z każdej gotowej
  // wyrzutni, rozrzut `torpedoSpread` = [wąski°, szeroki°] (cały kąt wachlarza). Amunicja liczy
  // wachlarze. turnRate / homingDelay zostają dla ścieżki strzału z rdzenia broni (bez trybu).
  siege_torpedo: {
    id: 'siege_torpedo', name: 'Siege Torpedo Mk I', mountType: 'missile', category: 'torpedo', size: 'L',
    baseDamage: 800, baseRange: 8000, baseSpeed: 1150, cooldown: 14.0, ammo: 6,
    turnRate: 80, homingDelay: 1.0, vfxColor: '#ff4444',
    burstCount: 3, torpedoSpread: [3, 11],
    explosionRadius: 200, armorPen: 3, recoil: 6, shake: 3,
    description: 'Ciężka torpeda przeciw okrętom liniowym: wachlarz trzech torped, wolna, ale niszczycielska.'
  },
  siege_torpedo_mk2: {
    id: 'siege_torpedo_mk2', name: 'Siege Torpedo Mk II', mountType: 'missile', category: 'torpedo', size: 'Capital',
    baseDamage: 1400, baseRange: 9000, baseSpeed: 1000, cooldown: 20.0, ammo: 4,
    turnRate: 60, homingDelay: 1.5, vfxColor: '#ff2222',
    burstCount: 2, torpedoSpread: [2, 8],
    explosionRadius: 350, armorPen: 5, recoil: 8, shake: 4,
    description: 'Torpeda oblężnicza klasy Capital: dwie potężne torpedy w wąskim wachlarzu. Łatwo je wyminąć — trzeba dobrze wyprzedzić cel.'
  },
  torpedo_salvo: {
    id: 'torpedo_salvo', name: 'Torpedo Salvo Launcher', mountType: 'missile', category: 'torpedo', size: 'L',
    baseDamage: 250, baseRange: 7000, baseSpeed: 1400, cooldown: 15.0, ammo: 12,
    turnRate: 120, homingDelay: 0.8, vfxColor: '#ff8844',
    burstCount: 6, burstDelay: 0.3, torpedoSpread: [5, 18],
    explosionRadius: 120, recoil: 5, shake: 2.5,
    description: 'Wachlarz sześciu lżejszych torped — szeroki rozrzut zamyka drogę ucieczki, wąski kładzie wszystkie w jeden kadłub.'
  },
  siege_railgun: {
    id: 'siege_railgun', name: 'Mjolnir Siege Railgun', mountType: 'special', category: 'rail', size: 'Capital',
    weaponClass: 'sniper',
    // Zasięg 20 km (2026-10-07, było 100): o 2 km dalej niż wzrok Atlasa — skraj zasięgu odsłania zwiad.
    baseDamage: 2500, baseRange: 20000, baseSpeed: 25000, cooldown: 8.0, chargeTime: 3.0,
    spread: 0.0005, penetration: 10, energyCost: 120, vfxColor: '#aaffff',
    // Przebija wszystko na drodze bez utraty energii (≤ 10 kadłubów, jak demo: pen 1e6).
    penDepth: Infinity, penSpeedLoss: 0,
    recoil: 120, shake: 80, impactScale: 5.0,
    requiresStationary: true,
    description: 'Extreme range railgun. Ship must be stationary to fire. Devastating single-shot damage.'
  }
};

// Ścieżki do ikon w interfejsie Mechanika
export const WEAPON_ICON_PATHS = {
  heavy_autocannon: 'assets/weapons/heavy_autocannon.svg',
  railgun_mk1: 'assets/weapons/railgun.svg',
  railgun_mk2: 'assets/weapons/railgun.svg',
  vulcan_minigun: 'assets/weapons/heavy_autocannon.svg',
  helios_laser: 'assets/weapons/railgun.svg',
  armata_mk1: 'assets/weapons/armata.svg',
  beam_continuous: 'assets/weapons/railgun.svg',
  beam_pulse: 'assets/weapons/railgun.svg',
  special_goliath_autocannon: 'assets/weapons/heavy_autocannon.svg',
  special_plasma_gatling: 'assets/weapons/railgun.svg',
  special_valkyrie_railgun: 'assets/weapons/railgun.svg',
  special_yamato_cannon: 'assets/weapons/supercapitalmain.png',
  hexlance_siege: 'assets/weapons/supercapitalmain.png',
  supernova_missile: 'assets/weapons/torpedo.svg',
  siege_torpedo: 'assets/weapons/torpedo.svg',
  siege_torpedo_mk2: 'assets/weapons/torpedo.svg',
  torpedo_salvo: 'assets/weapons/torpedo.svg',
  siege_railgun: 'assets/weapons/railgun.svg',
  ciws_mk1: 'assets/weapons/ciws.svg',
  ciws_mk2: 'assets/weapons/ciws.svg',
  laser_pd_mk1: 'assets/weapons/laser_pd.svg',
  flak_s: 'assets/weapons/flak.svg',
  flak_m: 'assets/weapons/flak.svg',
  flak_l: 'assets/weapons/flak.svg',
  flak_capital: 'assets/weapons/flak.svg',
  missile_rack: 'assets/weapons/missile_rack.svg',
  fast_missile_rack: 'assets/weapons/missile_rack.svg',
  roj_pod: 'assets/weapons/missile_rack.svg',
  grad_launcher: 'assets/weapons/missile_rack.svg',
  hydra_mirv: 'assets/weapons/missile_rack.svg',
  // S/M/L variants reuse the family icons
  tempest_ion_s: 'assets/weapons/railgun.svg',
  tempest_ion_l: 'assets/weapons/railgun.svg',
  helios_laser_s: 'assets/weapons/railgun.svg',
  helios_lance_l: 'assets/weapons/railgun.svg',
  gatling_s: 'assets/weapons/heavy_autocannon.svg',
  heavy_autocannon_l: 'assets/weapons/heavy_autocannon.svg',
  lance_rail_m: 'assets/weapons/railgun.svg',
  lance_rail_l: 'assets/weapons/railgun.svg',
  // Warianty rozmiarowe broni specjalnej — ikony rodziców
  special_valkyrie_s: 'assets/weapons/railgun.svg',
  special_valkyrie_m: 'assets/weapons/railgun.svg',
  special_yamato_l: 'assets/weapons/supercapitalmain.png'
};

// ===========================================================================
// TYP RAŻENIA I AMUNICJA
// ---------------------------------------------------------------------------
// Podział na balistykę i energię nie jest kosmetyczny — to on decyduje, co
// gospodarka musi produkować W SPOSÓB CIĄGŁY. Działo balistyczne bez skrzyń
// amunicji jest złomem na podstawie, emiter energetyczny potrzebuje wyłącznie
// mocy reaktora. Stąd bierze się różnica ról: energia jest droga w budowie
// i tania w użyciu, balistyka odwrotnie.
//
// Klasyfikacja idzie po `category`, a nie po wpisie w każdej broni — 32 pozycje
// przepisane ręcznie rozjechałyby się przy pierwszej nowej lufie.
// ===========================================================================

export const DAMAGE_TYPE = Object.freeze({
  BALLISTIC: 'ballistic',
  ENERGY: 'energy',
  /** Hangary nie rażą — wypuszczają eskadry i mają własny łańcuch zaopatrzenia. */
  CARRIER: 'carrier'
});

/** Identyfikatory amunicji są zarazem kluczami surowców w `resources.js`. */
export const AMMO_TYPE = Object.freeze({
  KINETIC: 'ammo_kinetic',
  FLAK: 'flak_shell',
  MISSILE: 'missile_round',
  TORPEDO: 'torpedo_round'
});

/** Klasy handlowe uzbrojenia — tym gospodarka handluje zamiast 32 modelami. */
export const WEAPON_GOOD = Object.freeze({
  BALLISTIC: 'gun_ballistic',
  ENERGY: 'gun_energy',
  ORDNANCE: 'launcher_ordnance',
  POINT_DEFENCE: 'pd_turret',
  /** Hangar nie kupuje lufy, tylko maszyny — i to one są jego amunicją. */
  SQUADRON: 'fighter_craft'
});

/**
 * Profil kategorii. `shotsPerAmmo` mówi, ile strzałów daje JEDNA sztuka
 * amunicji przy rozmiarze M — bo sztuką jest skrzynia/zasobnik, nie pojedynczy
 * nabój. Gatling ma sypać seriami i nadal nie zjadać magazynu portu.
 *
 * Rakiety i torpedy są wyjątkiem z natury: tam jedna sztuka to jeden pocisk,
 * więc `shotsPerAmmo` wynosi 1 niezależnie od rozmiaru wyrzutni.
 */
const CATEGORY_PROFILE = Object.freeze({
  rail: { damage: DAMAGE_TYPE.BALLISTIC, ammo: AMMO_TYPE.KINETIC, shotsPerAmmo: 20, good: WEAPON_GOOD.BALLISTIC },
  autocannon: { damage: DAMAGE_TYPE.BALLISTIC, ammo: AMMO_TYPE.KINETIC, shotsPerAmmo: 45, good: WEAPON_GOOD.BALLISTIC },
  armata: { damage: DAMAGE_TYPE.BALLISTIC, ammo: AMMO_TYPE.KINETIC, shotsPerAmmo: 6, good: WEAPON_GOOD.BALLISTIC },
  ciws: { damage: DAMAGE_TYPE.BALLISTIC, ammo: AMMO_TYPE.KINETIC, shotsPerAmmo: 60, good: WEAPON_GOOD.POINT_DEFENCE },
  flak: { damage: DAMAGE_TYPE.BALLISTIC, ammo: AMMO_TYPE.FLAK, shotsPerAmmo: 8, good: WEAPON_GOOD.POINT_DEFENCE },
  rocket: { damage: DAMAGE_TYPE.BALLISTIC, ammo: AMMO_TYPE.MISSILE, shotsPerAmmo: 1, good: WEAPON_GOOD.ORDNANCE },
  torpedo: { damage: DAMAGE_TYPE.BALLISTIC, ammo: AMMO_TYPE.TORPEDO, shotsPerAmmo: 1, good: WEAPON_GOOD.ORDNANCE },
  beam: { damage: DAMAGE_TYPE.ENERGY, ammo: null, shotsPerAmmo: 0, good: WEAPON_GOOD.ENERGY },
  plasma: { damage: DAMAGE_TYPE.ENERGY, ammo: null, shotsPerAmmo: 0, good: WEAPON_GOOD.ENERGY },
  superweapon: { damage: DAMAGE_TYPE.ENERGY, ammo: null, shotsPerAmmo: 0, good: WEAPON_GOOD.ENERGY },
  // Hangar nie rani niczym własnym — wypuszcza maszyny. Jego „amunicją" są
  // rakiety, które eskadra wystrzeliwuje przy wylocie (`missileAmmo`), ale
  // liczy je `weaponEconomy.squadronRearmCost`, bo zależą od typu eskadry,
  // a nie od samego gniazda.
  hangar: { damage: DAMAGE_TYPE.CARRIER, ammo: null, shotsPerAmmo: 0, good: WEAPON_GOOD.SQUADRON }
});

/**
 * Ile skrzyń amunicji zjada rozmiar. Większa lufa to nie tylko mocniejszy
 * strzał, ale i grubszy nabój — bez tego składnika Capital strzelałby tak
 * tanio jak fregata i wielkość przestałaby cokolwiek kosztować.
 */
const AMMO_SIZE_FACTOR = Object.freeze({ S: 0.5, M: 1, L: 2.5, Capital: 6 });

/**
 * To samo dla pocisków, ale znacznie płaszcze: rakieta JEST sztuką amunicji,
 * więc rozmiar wyrzutni nie mnoży zużycia tak jak kaliber lufy. Rozróżniamy
 * tylko lekkie pociski myśliwskie (pół sztuki) i głowice ciężkie klasy
 * Capital, które zjadają kilka. Bez tego „Osa" — mikrorakieta odpalana
 * sześćdziesiąt razy na minutę — kosztowałaby tyle co pocisk manewrujący.
 *
 * 0,2 dla S wzięło się z eskadr: przy 0,5 przezbrojenie klucza myśliwców
 * kosztowało WIĘCEJ niż same maszyny, co znaczyłoby, że taniej stracić eskadrę
 * niż ją uzupełnić.
 */
const ORDNANCE_SIZE_FACTOR = Object.freeze({ S: 0.2, M: 1, L: 1, Capital: 3 });

function weaponDef(weaponOrId) {
  if (weaponOrId && typeof weaponOrId === 'object') return weaponOrId;
  return MASTER_WEAPONS[String(weaponOrId || '')] || null;
}

function profileOf(weaponOrId) {
  const def = weaponDef(weaponOrId);
  return def ? CATEGORY_PROFILE[def.category] || null : null;
}

/**
 * Klasa trafienia w tarczę dla efektów tarczy (src/3d/shield3D.js — płytki, fala, iskry):
 * `pd` | `main` | `special`. Rolę niesie `mountType` — aux to broń defensywna,
 * special/builtin to superciężkie. Jedyny dodatek: kaliber Capital na zaczepie
 * głównym/rakietowym (torpeda oblężnicza) liczy się jak special, bo trafienie
 * ma tę samą wagę co bateria klasy Yamato. Aux zostaje przy `pd` niezależnie od
 * rozmiaru — zapora flak „Perun" to nadal ogień defensywny.
 * Broń spoza katalogu (pociski spawnowane poza fireWeaponCore) → `main`.
 */
export function shieldImpactClass(weaponOrId) {
  const def = weaponDef(weaponOrId);
  const mount = def?.mountType;
  if (mount === 'aux') return 'pd';
  if (mount === 'special' || mount === 'special_missile' || mount === 'builtin') return 'special';
  if (def?.size === 'Capital') return 'special';
  return 'main';
}

/** `ballistic` | `energy` | `carrier`. Nieznana broń liczy się jak balistyczna. */
export function weaponDamageType(weaponOrId) {
  return profileOf(weaponOrId)?.damage || DAMAGE_TYPE.BALLISTIC;
}

export function isBallistic(weaponOrId) {
  return weaponDamageType(weaponOrId) === DAMAGE_TYPE.BALLISTIC;
}

export function isEnergy(weaponOrId) {
  return weaponDamageType(weaponOrId) === DAMAGE_TYPE.ENERGY;
}

/** Klucz surowca-amunicji albo `null`, gdy broń nie potrzebuje magazynu. */
export function weaponAmmoType(weaponOrId) {
  return profileOf(weaponOrId)?.ammo || null;
}

/** Klasa handlowa uzbrojenia — to nią handluje gospodarka. */
export function weaponTradeGood(weaponOrId) {
  return profileOf(weaponOrId)?.good || null;
}

/**
 * Ile sztuk amunicji kosztuje jeden strzał. Salwy (`burstCount`) i wielolufowce
 * (`barrelsPerShot`) zjadają tyle, ile naprawdę wypuszczają — inaczej „Grad
 * Flak" z trzema pęknięciami byłby tak samo tani jak lekki kartacz.
 */
export function weaponAmmoPerShot(weaponOrId) {
  const def = weaponDef(weaponOrId);
  const profile = profileOf(def);
  if (!def || !profile?.ammo) return 0;
  const pociski = Math.max(1, Number(def.burstCount) || 1) * Math.max(1, Number(def.barrelsPerShot) || 1);
  if (profile.shotsPerAmmo <= 1) return pociski * ordnancePerMissile(def);
  const factor = AMMO_SIZE_FACTOR[def.size] ?? 1;
  return (pociski * factor) / profile.shotsPerAmmo;
}

/**
 * Sztuk amunicji na JEDNĄ rakietę / torpedę: mikrorakieta salwy (Grad, Rój) jest ułamkiem
 * pocisku manewrującego, reszta — czynnik rozmiaru wyrzutni.
 */
function ordnancePerMissile(def) {
  const own = Number(def?.ordnancePerMissile);
  if (Number.isFinite(own) && own > 0) return own;
  return ORDNANCE_SIZE_FACTOR[def?.size] ?? 1;
}

/**
 * Ile amunicji zjada JEDEN pocisk broni — bez salwy. Myśliwce noszą rakiety sztukami
 * (`missileAmmo` eskadry) i odpalają je pojedynczo, więc ich przezbrojenie liczy się stąd,
 * a nie z salwy wyrzutni okrętowej (fast_missile_rack: 4 rakiety na naciśnięcie).
 */
export function weaponAmmoPerMissile(weaponOrId) {
  const def = weaponDef(weaponOrId);
  const profile = profileOf(def);
  if (!def || !profile?.ammo) return 0;
  const salwa = Math.max(1, Number(def.burstCount) || 1);
  return weaponAmmoPerShot(def) / salwa;
}

/** Liczba rakiet w salwie wyrzutni (burstCount rakiet; 1 — pojedynczy strzał). */
export function rocketSalvoSize(weaponOrId) {
  const def = weaponDef(weaponOrId);
  const n = Math.round(Number(def?.burstCount) || 1);
  return n > 1 ? n : 1;
}

/**
 * Definicja rakiety POTOMNEJ głowicy kasetowej (Hydra) — zbudowana raz z pola `submunition`
 * rodzica i trzymana na nim (nie trafia do MASTER_WEAPONS: nie da się jej kupić ani zamontować).
 * Obrażenia potomnej = baseDamage rodzica (modyfikatory okrętu niesie wystrzał rodzica).
 */
export function submunitionDef(weaponOrId) {
  const def = weaponDef(weaponOrId);
  const sub = def?.submunition;
  if (!sub) return null;
  if (def.__subDef) return def.__subDef;
  const child = Object.freeze({
    id: `${def.id}__sub`,
    name: `${def.name} (głowica)`,
    mountType: 'submunition',
    category: 'rocket',
    size: 'S',
    baseDamage: def.baseDamage,
    baseRange: Math.max(3000, Number(sub.splitRange) * 3 || 6000),
    vfxColor: def.vfxColor,
    ...sub,
    burstCount: 1,
    submunition: null,
    parentId: def.id
  });
  // Pole niewyliczalne: katalogi i serializacja widzą samą kartę broni.
  Object.defineProperty(def, '__subDef', { value: child, enumerable: false, configurable: true });
  return child;
}

/** Ile sztuk amunicji zjada minuta ognia ciągłego — miara dla zaopatrzenia. */
export function weaponAmmoPerMinute(weaponOrId) {
  const def = weaponDef(weaponOrId);
  if (!def) return 0;
  const cooldown = Math.max(0.02, Number(def.cooldown) || 1);
  return weaponAmmoPerShot(def) * (60 / cooldown);
}

/** Wszystkie bronie danego typu rażenia — do UI, testów i bilansu. */
export function listWeaponsByDamageType(damageType) {
  return Object.values(MASTER_WEAPONS).filter(def => weaponDamageType(def) === damageType);
}

// ===========================================================================
// WEAPON SIZE CLASS (S / M / L / Capital)
// ---------------------------------------------------------------------------
// Used by the workshop / hardpoint editor to gate fitting: a weapon fits a
// hardpoint when the weapon's size rank is <= the hardpoint's size rank
// (a smaller weapon can sit in a bigger slot, never the other way round).
// ===========================================================================
export const WEAPON_SIZES = ['S', 'M', 'L', 'Capital'];

export const WEAPON_SIZE_RANK = Object.freeze({ S: 1, M: 2, L: 3, Capital: 4 });

export const WEAPON_SIZE_LABEL = Object.freeze({ S: 'S', M: 'M', L: 'L', Capital: 'C' });

export function getWeaponSizeRank(size) {
  return WEAPON_SIZE_RANK[String(size || 'M').trim()] || WEAPON_SIZE_RANK.M;
}

// True when a weapon of `weaponSize` may be mounted in a hardpoint of `hpSize`.
export function weaponFitsHardpointSize(weaponSize, hpSize) {
  return getWeaponSizeRank(weaponSize) <= getWeaponSizeRank(hpSize);
}
