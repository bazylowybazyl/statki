// Ścieżki map planet (gra: planet3d.assets.js, tło menu: menuBackdrop3D.js).
//
// Mapy planet z generatora (scripts/planety/: Ziemia „zajechana” z wielką kopalnią ringu, Mars
// w trakcie terraformacji). Dawne zdjęcia NASA zostają do porównania: `?planety=stare` albo
// localStorage `sc_planet_maps = 'stare'` (bez dziury i bez map Marsa).
const PLANET_MAPS_OLD = (() => {
    try {
        if (new URLSearchParams(window.location.search).get('planety') === 'stare') return true;
        return window.localStorage?.getItem('sc_planet_maps') === 'stare';
    } catch { return false; }
})();
export const PLANET_MAPS = Object.freeze(PLANET_MAPS_OLD ? {
    earth: { day: 'assets/planety/solar/earth/earth_color.jpg', night: 'assets/planety/images/earth_nightmap.jpg',
        spec: 'assets/planety/images/earth_specularmap.jpg', normal: 'assets/planety/solar/earth/earth_normal.jpg',
        clouds: 'assets/planety/solar/earth/earth_clouds.jpg', pit: false }
} : {
    earth: { day: 'assets/planety/solar/earth/earth_hf_color.jpg', night: 'assets/planety/solar/earth/earth_hf_night.jpg',
        spec: 'assets/planety/solar/earth/earth_hf_water.jpg', normal: 'assets/planety/solar/earth/earth_hf_normal.jpg',
        clouds: 'assets/planety/solar/earth/earth_hf_clouds.jpg', pit: true,
        // zapylona atmosfera wysuszonej Ziemi: mgiełka płowa (pył), słabiej gasi błękit niż czyste powietrze
        haze: { strength: 0.8, color: [0.80, 0.72, 0.60], beta: [0.06, 0.085, 0.12] },
        menuAir: { ext: [0.028, 0.040, 0.064], day: [0.66, 0.62, 0.62] } },
    // Mars w trakcie terraformacji: ocean północny, morza Hellas i Argyre, zieleń; gęstsze powietrze (mgiełka
    // mocniej niż dziś, nadal błękitne zachody — beta z większym R)
    mars: { day: 'assets/planety/solar/mars/mars_hf_color.jpg', night: 'assets/planety/solar/mars/mars_hf_night.jpg',
        spec: 'assets/planety/solar/mars/mars_hf_water.jpg', normal: 'assets/planety/solar/mars/mars_hf_normal.jpg',
        clouds: 'assets/planety/solar/mars/mars_hf_clouds.jpg', specular: 1.0, cloudOpacity: 0.55,
        haze: { strength: 0.34, color: [0.80, 0.72, 0.64], beta: [0.12, 0.10, 0.08] } },
    // Merkury — planeta-kopalnia (scripts/planety/merkury.py): odkrywki, huty, wyrzutnie masy, wyciągi i globalna
    // sieć tras, nocą huty i przerywane łańcuchy świateł; bez atmosfery (bez mgiełki), połysk tylko farm słonecznych
    mercury: { day: 'assets/planety/solar/mercury/mercury_hf_color.jpg', night: 'assets/planety/solar/mercury/mercury_hf_night.jpg',
        spec: 'assets/planety/solar/mercury/mercury_hf_spec.jpg', normal: 'assets/planety/solar/mercury/mercury_hf_normal.jpg',
        specular: 0.6 },
    // Wenus — planeta fabryk (scripts/planety/wenus.py): kopalnie miedzi na wyżynach (szron metaliczny), kryształ
    // w tesserach, fabryki elektroniki i miasta na płaskowyżach, huty, zakłady amunicyjne, sieć tras. Chmury = pasma
    // dawnej venus_atmosphere.jpg z przerwami (nocą gasną, światła miast widać), mgiełka bez zmian (planet3d.assets.js)
    venus: { day: 'assets/planety/solar/venus/venus_hf_color.jpg', night: 'assets/planety/solar/venus/venus_hf_night.jpg',
        spec: 'assets/planety/solar/venus/venus_hf_spec.jpg', normal: 'assets/planety/solar/venus/venus_hf_normal.jpg',
        clouds: 'assets/planety/solar/venus/venus_hf_clouds.jpg', cloudOpacity: 0.4, specular: 0.5 },
    // Jowisz: ostra mozaika Cassini (PIA07782, scripts/planety/jowisz.py) w barwach dawnej mapy; pasy i wiry
    // animuje shader (jupiterAtmosphere*.js — położenia wirów zmierzone na tej mapie)
    jupiter: { day: 'assets/planety/solar/jupiter/jupiter_cassini_color.jpg' },
    // Saturn (scripts/planety/saturn.py): pasy z map Hubble OPAL, detal i obiekty (burza 2011, sześciokąt, wiry polarne)
    // w położeniach z src/data/saturnAtmosphere.js — animuje je shader (saturnAtmosphere*.js, `atmosphere`); mgiełka
    // ciepła i słaba (gruba warstwa mgły nad chmurami Saturna gasi kontrast ku brzegowi tarczy)
    saturn: { day: 'assets/planety/solar/saturn/saturn_hf_color.jpg', atmosphere: true,
        haze: { strength: 0.3, color: [0.93, 0.83, 0.64], beta: [0.06, 0.08, 0.12] } }
});

// Mapy księżyców (DirectMoon w planet3d.assets.js; klucz = id strojenia księżyca, Luna = 'moon'). Z generatora
// scripts/planety/ksiezyce.py: dzień (LRO / Galileo + Voyager), noc (światła wg roli w ekonomii: Luna — Terra
// Nova, Io / Ganimedes / Kallisto — Konsorcjum Zewnętrzne, Europa — Unia Pasa) i normalne (R = wschód, G = północ).
// `?planety=stare` — dawne mapy (Luna z mapą wypukłości, bez nocy i bez normalnych).
const MOON_DIR = 'assets/planety/solar/moons';
export const MOON_MAPS = Object.freeze(PLANET_MAPS_OLD ? {
    moon: { day: 'assets/planety/images/moonmap.jpg', bump: 'assets/planety/images/moonbump.jpg', bumpScale: 0.07 },
    io: { day: 'assets/planety/images/jupiterIo.jpg' },
    europa: { day: 'assets/planety/images/jupiterEuropa.jpg' },
    ganymede: { day: 'assets/planety/images/jupiterGanymede.jpg' },
    callisto: { day: 'assets/planety/images/jupiterCallisto.jpg' }
} : {
    moon: { day: `${MOON_DIR}/luna_hf_color.jpg`, night: `${MOON_DIR}/luna_hf_night.jpg`, normal: `${MOON_DIR}/luna_hf_normal.jpg`, normalScale: 1.0 },
    io: { day: `${MOON_DIR}/io_hf_color.jpg`, night: `${MOON_DIR}/io_hf_night.jpg`, normal: `${MOON_DIR}/io_hf_normal.jpg`, normalScale: 1.0 },
    europa: { day: `${MOON_DIR}/europa_hf_color.jpg`, night: `${MOON_DIR}/europa_hf_night.jpg`, normal: `${MOON_DIR}/europa_hf_normal.jpg`, normalScale: 1.0 },
    ganymede: { day: `${MOON_DIR}/ganymede_hf_color.jpg`, night: `${MOON_DIR}/ganymede_hf_night.jpg`, normal: `${MOON_DIR}/ganymede_hf_normal.jpg`, normalScale: 1.0 },
    callisto: { day: `${MOON_DIR}/callisto_hf_color.jpg`, night: `${MOON_DIR}/callisto_hf_night.jpg`, normal: `${MOON_DIR}/callisto_hf_normal.jpg`, normalScale: 1.0 }
});
