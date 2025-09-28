// systems/bazyl.adapter.js
//
// Adapter z formatu repo "bazylowybazyl/planety" na nasz format listy
// oczekiwany przez initPlanets3D(list, sunObj).

/**
 * @param {Object} raw - Dane wczytane z repo Bazyl (JSON/JS).
 *  Oczekiwane (elastycznie): raw.star, raw.planets[] z polami typu:
 *   - name, radius (km?), type ("terrestrial"/"gas"/"ice"/itp.),
 *   - orbitRadius (AU/km/…),
 *   - orbitalPeriod (dni/sekundy/…)
 */
export function bazylToOurSystem(raw) {
  const planetsSrc = Array.isArray(raw?.planets) ? raw.planets : [];

  // 1) Ustal skale jednostek (dostosuj po obejrzeniu danych):
  //    - promienie planet przeskaluj do ~[10..60] (nasz świat)
  //    - dystans Słońce–Ziemia (1 AU) ≈ np. 3000 world units (bez wychodzenia poza WORLD)
  const AU_TO_WORLD = 3000;
  const KM_TO_WORLD_RADIUS = 0.01;
  const ORBIT_SPEED_SCALE = 720; // przyspiesz okresy dla czytelnego ruchu

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // 2) Mapowanie typów/kolorystyki na nasze presety
  const typeMap = (t) => {
    const k = (t || '').toLowerCase();
    if (k.includes('ter') || k.includes('rock')) return 'terran';
    if (k.includes('gas')) return 'gas';
    if (k.includes('ice')) return 'ice';
    if (k.includes('water')) return 'terran';
    return 'terran';
  };

  // 3) Słońce
  const sunRadiusWorld = clamp(
    (raw?.star?.radiusKm || raw?.star?.radius || 300000) * KM_TO_WORLD_RADIUS * 0.1,
    320,
    1400
  );
  const sunObj = {
    x: 0,
    y: 0,
    r: sunRadiusWorld,
  };

  // Pomocnicze: wyciągnij orbitę w AU lub km i przelicz
  const orbitToWorld = (p) => {
    if (p.orbitRadiusAU != null) return p.orbitRadiusAU * AU_TO_WORLD;
    if (p.orbitRadiusAu != null) return p.orbitRadiusAu * AU_TO_WORLD;
    if (p.orbitRadius != null && typeof p.orbitRadius === 'number') return p.orbitRadius * AU_TO_WORLD;
    if (p.semiMajorAxisAU != null) return p.semiMajorAxisAU * AU_TO_WORLD;
    if (p.orbitRadiusKm != null) return p.orbitRadiusKm * KM_TO_WORLD_RADIUS;
    if (p.semiMajorAxisKm != null) return p.semiMajorAxisKm * KM_TO_WORLD_RADIUS;
    return 0;
  };

  const periodToSeconds = (p) => {
    if (p.orbitalPeriodSeconds != null) return p.orbitalPeriodSeconds;
    if (p.orbitalPeriodDays != null) return p.orbitalPeriodDays * 24 * 3600;
    if (p.orbitalPeriodHours != null) return p.orbitalPeriodHours * 3600;
    if (p.orbitalPeriod != null && typeof p.orbitalPeriod === 'number') return p.orbitalPeriod;
    return 0;
  };

  // 4) Planety → nasz format wejściowy
  const list = planetsSrc.map((p, i) => {
    const orbitWorld = orbitToWorld(p);
    const radiusWorld = clamp(
      (p.radiusKm || p.radius || 3000) * KM_TO_WORLD_RADIUS,
      12,
      80
    );

    const sunX = sunObj.x;
    const sunY = sunObj.y;

    const angle0 = (typeof p.orbitPhase === 'number') ? p.orbitPhase : 0;
    const x0 = sunX + Math.cos(angle0) * orbitWorld;
    const y0 = sunY + Math.sin(angle0) * orbitWorld;

    let orbitSpeed = 0;
    const Tsec = periodToSeconds(p);
    if (Tsec > 0) {
      orbitSpeed = ((2 * Math.PI) / Tsec) * ORBIT_SPEED_SCALE;
    }

    return {
      name: p.name || `Planet ${i + 1}`,
      type: typeMap(p.type),
      r: radiusWorld,
      x: x0,
      y: y0,
      orbitRadius: orbitWorld,
      orbitSpeed,
      orbitPhase: angle0,
    };
  });

  // 5) Uzupełnij „orbitRadius” dla dwóch sąsiadujących planet (do pasa asteroid)
  list.sort((a, b) => (a.orbitRadius || 0) - (b.orbitRadius || 0));

  return { list, sunObj };
}
