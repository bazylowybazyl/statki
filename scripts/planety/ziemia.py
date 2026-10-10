# -*- coding: utf-8 -*-
"""Generator map Ziemi „zajechanej” (daleka przyszłość HULLFALL).

Ludzkość żyje na ringu „Halo”, oceany wypompowano (woda poszła na ring), na Ziemi
został przemysł i roboty. Wejście: ETOPO 2022 (NOAA, domena publiczna — wysokość lądu
i dna) oraz dotychczasowe mapy gry (kolor lądu jako detal, światła miast jako miejsca
dawnych metropolii, chmury). Wyjście: kolor dnia, noc, maska wody, normalne, chmury.

  .tmp/venv-planety/Scripts/python -I scripts/planety/ziemia.py --szer 2048            # podgląd
  .tmp/venv-planety/Scripts/python -I scripts/planety/ziemia.py --szer 8192 --do-gry   # mapy gry

Dane: .tmp/planety-dane/etopo/surface.tif i bed.tif (ETOPO_2022_v1_60s_N90W180_*.tif).
"""
import argparse
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
from wspolne import *  # noqa: E402,F401,F403
import dziura  # noqa: E402

R_ZIEMI_KM = 6371.0

P = dict(
    poziom_morza=-4800.0,       # nowy poziom szczątkowych mórz [m]
    min_morze_km2=60000.0,      # mniejsze baseny wyschły do solnisk
    przewyzszenie=3.2,          # rzeźba w mapie normalnych
    ziarno=7,
    huby=170,                   # strefy przemysłu w miejscach dawnych metropolii
    kopalnie_dna=70,            # pola odkrywek na dawnym dnie
    kopalnie_gor=90,            # odkrywki w górach i na pustyniach
)

# Paleta (sRGB) — barwy jak z orbity, bez cieniowania (to robi mapa normalnych)
PAL = {k: kolor(v) for k, v in dict(
    las_martwy='#4f4638', step='#8c7853', pustynia='#c09a66', skala='#77706a', lod='#cfc9bf', lod_brudny='#9e978c',
    szelf='#a99978', szelf_jasny='#c2b596', stok='#7a6e5e', mul='#5f5548', bazalt='#3a3634', sol='#e2dccd',
    wapien='#9f9581', il='#6a5244', krzemion='#7f7b71',
    solanka_roz='#b26a6a', solanka_poma='#c4895c', plaza='#d8c7a4',
    woda_plytka='#3c8576', woda_srednia='#1f4b4a', woda_gleboka='#0f2a2e', glony='#5b5a2e',
    przem='#4a4845', przem_jasny='#8c8a85', przem_ciemny='#2c2b2a',
    osad1='#9c6a3c', osad2='#7a4632', osad3='#4f7a70', osad4='#8a8a4c',
    odkr_jasna='#988e7f', odkr_ciemna='#5a524a', droga='#a49c8f',
).items()}
NOC = {k: kolor(v) for k, v in dict(
    sod='#ffb35a', biel='#fff1d8', huta='#ff6a2a', flara='#ff4a1e', ruina='#ffcf8a', zimna='#d8e8ff',
).items()}


# ── Dane ───────────────────────────────────────────────────────────────────────
def wczytaj_etopo(nazwa, W, H):
    cache = os.path.join(KATALOG_DANYCH, 'etopo', f'{nazwa}_{W}.npy')
    if os.path.exists(cache):
        return np.load(cache)
    import tifffile
    src = os.path.join(KATALOG_DANYCH, 'etopo', f'{nazwa}.tif')
    with tifffile.TiffFile(src) as tf:
        a = tf.pages[0].asarray()
    a = przeskaluj(a, W, H)
    np.save(cache, a)
    return a


def wagi_powierzchni(H):
    lat = np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi
    return np.cos(lat).astype(np.float32)


def km2_piksela(W, H):
    """Pole piksela [km²] w wierszach (H, 1)."""
    lat = np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi
    return ((2 * np.pi * R_ZIEMI_KM / W) * (np.pi * R_ZIEMI_KM / H) * np.cos(lat)).astype(np.float32)[:, None]


# ── Okna lokalne (strefy, odkrywki, kopalnie) ───────────────────────────────────
def okno(lon0, lat0, promien_km, W, H):
    """Wiersze, kolumny (zawinięte) i lokalne x (wschód), y (północ) w km wokół punktu."""
    dlat = promien_km / R_ZIEMI_KM
    cl = max(math.cos(math.radians(lat0)), 0.05)
    dlon = dlat / cl
    j0 = max(0, int((math.pi / 2 - (math.radians(lat0) + dlat)) / math.pi * H) - 1)
    j1 = min(H, int((math.pi / 2 - (math.radians(lat0) - dlat)) / math.pi * H) + 2)
    i_c = (math.radians(lon0) + math.pi) / (2 * math.pi) * W
    di = int(dlon / (2 * math.pi) * W) + 2
    cols = np.arange(int(i_c) - di, int(i_c) + di + 1) % W
    rows = np.arange(j0, j1)
    lon = (cols + 0.5) / W * 2 * np.pi - np.pi
    lat = np.pi / 2 - (rows + 0.5) / H * np.pi
    dl = (lon - math.radians(lon0) + np.pi) % (2 * np.pi) - np.pi
    x = (R_ZIEMI_KM * np.cos(lat)[:, None] * dl[None, :]).astype(np.float32)
    y = np.broadcast_to((R_ZIEMI_KM * (lat - math.radians(lat0)))[:, None], x.shape).astype(np.float32)
    return rows, cols, x, y


def wpisz_max(dst, rows, cols, v):
    sub = dst[np.ix_(rows, cols)]
    dst[np.ix_(rows, cols)] = np.maximum(sub, v)


def wpisz_mix(dst, rows, cols, barwa, t):
    sub = dst[np.ix_(rows, cols)]
    dst[np.ix_(rows, cols)] = sub + (barwa[None, None, :] - sub) * t[..., None]


def dodaj(dst, rows, cols, v):
    if v.ndim == 3:
        dst[np.ix_(rows, cols)] += v
    else:
        dst[np.ix_(rows, cols)] += v


def szum2(x, y, skala, ziarno):
    """Szum 2D w oknie (płaszczyzna z = ziarno)."""
    return szum3(x * skala, y * skala, np.full_like(x, ziarno * 13.37), ziarno)


# ── Generator ──────────────────────────────────────────────────────────────────
def generuj(W, H, wyj, podglady, do_gry=False):
    t0 = time.time()
    rng = np.random.default_rng(P['ziarno'])
    log = lambda m: print(f'[{time.time() - t0:6.1f} s] {m}', flush=True)  # noqa: E731

    e = wczytaj_etopo('surface', W, H)
    try:
        bed = wczytaj_etopo('bed', W, H)
        lod = smoothstep(20.0, 300.0, e - bed)
    except Exception as err:  # bez bed.tif — lód z barwy
        print('brak bed.tif, lód z obrazu:', err)
        lod = None
    log('ETOPO')

    piks_km2 = km2_piksela(W, H)
    px_km = 2 * math.pi * R_ZIEMI_KM / W               # bok piksela na równiku [km]
    S = P['poziom_morza']

    # ── woda: szczątkowe morza w najgłębszych basenach ───────────────────────────
    from scipy import ndimage as ndi
    pod = e < S
    lab, n = ndi.label(pod)
    pola = ndi.sum(np.broadcast_to(piks_km2, e.shape), lab, index=np.arange(1, n + 1))
    duze = np.zeros(n + 1, bool)
    duze[1:] = pola >= P['min_morze_km2']
    woda = duze[lab]
    wyschniete = pod & ~woda                            # małe baseny → solniska
    glebokosc = np.where(woda, S - e, 0.0).astype(np.float32)
    dist_woda_px = ndi.distance_transform_edt(~woda).astype(np.float32)
    log(f'woda {100 * (woda * wagi_powierzchni(H)[:, None]).sum() / wagi_powierzchni(H)[:, None].sum() / W:.1f}% powierzchni, baseny {n}')

    dno = (e < 0) & ~woda                                # dawne dno morza
    rel_mala = e - rozmyj_kula(e, max(1.0, 18.0 / px_km))       # rzeźba ~20 km
    rel_duza = e - rozmyj_kula(e, max(2.0, 160.0 / px_km))      # obniżenia ~200 km
    log('pola rzeźby')

    # ── stary obraz: detal lądu, maska oceanu z mapy połysku ──────────────────────
    img = wczytaj_obraz(os.path.join(KATALOG_REPO, 'public/assets/planety/solar/earth/earth_color.jpg'), W, H)
    spec_old = wczytaj_szary(os.path.join(KATALOG_REPO, 'public/assets/planety/images/earth_specularmap.jpg'), W, H)
    img_ocean = smoothstep(0.35, 0.65, spec_old)
    L = luminancja(img)
    srgb = lin_do_srgb(img)
    zielen = np.clip((srgb[..., 1] - 0.5 * (srgb[..., 0] + srgb[..., 2])) * 6.0, 0, 1)       # roślinność dawnych lądów
    if lod is None:
        lod = smoothstep(0.45, 0.7, L) * smoothstep(0.55, 0.8, np.abs(np.linspace(1, -1, H))[:, None] * np.ones((1, W)))
    log('obraz')

    # szum pomocniczy (kierunek 3D — bez szwu)
    sz_a = pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, 9.0, 5, P['ziarno']))
    sz_b = pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, 38.0, 4, P['ziarno'] + 3))
    sz_c = pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, 160.0, 3, P['ziarno'] + 5))
    log('szum')

    # ── ląd: martwa roślinność, wyschnięte stepy, pustynie cieplej ────────────────
    # detal jasności obrazu względem tła 200 km — barwa z palety, rysunek z obrazu
    L_tlo = rozmyj_kula(L, max(1.0, 200.0 / px_km))
    Lr = np.clip(L / np.maximum(L_tlo, 0.01), 0.45, 1.9)[..., None]
    martwe = mix(PAL['las_martwy'][None, None, :] * np.ones((H, W, 1), np.float32), PAL['step'], smoothstep(0.03, 0.14, L_tlo) * 0.8 + 0.2 * sz_a)
    martwe = martwe * Lr
    suchy = img * np.array([1.08, 0.97, 0.84], np.float32)          # cieplej, mniej błękitu
    sz = luminancja(suchy)[..., None]
    suchy = sz + (suchy - sz) * 0.62                                 # mniej nasycenia
    lad = mix(suchy, martwe, np.clip(zielen * 1.4, 0, 1))
    lad = mix(lad, PAL['pustynia'][None, None, :] * Lr, 0.12)        # wszystko pod warstwą pyłu
    lad = mix(lad, lad * (0.82 + 0.36 * sz_b[..., None]), 0.5)
    # lód: brudny, z pyłem
    lodowy = mix(PAL['lod'][None, None, :] * np.clip(L / 0.6, 0.6, 1.2)[..., None], PAL['lod_brudny'][None, None, :], sz_a * 0.8)
    lad = mix(lad, lodowy, lod * (e >= 0))
    log('ląd')

    # ── dawne dno ─────────────────────────────────────────────────────────────────
    gl = np.clip(-e, 0, None)
    b_dno = mix(PAL['szelf_jasny'][None, None, :] * np.ones((H, W, 1), np.float32), PAL['szelf'], smoothstep(10, 160, gl))
    b_dno = mix(b_dno, PAL['stok'], smoothstep(180, 1600, gl))
    # osady głębinowe jak w prawdziwych oceanach: nad głębokością kompensacji węglanów (~4,5 km)
    # biały muł wapienny, głębiej czerwony ił, na dużych szerokościach szary muł krzemionkowy
    b_dno = mix(b_dno, PAL['mul'], smoothstep(1800, 3000, gl))
    ccd = 4400.0 + 900.0 * (sz_a - 0.5) + 400.0 * (sz_b - 0.5)
    b_dno = mix(b_dno, PAL['wapien'], smoothstep(2200, 3200, gl) * smoothstep(ccd + 300, ccd - 600, gl) * 0.8)
    b_dno = mix(b_dno, PAL['il'], smoothstep(ccd - 500, ccd + 600, gl) * 0.85)
    szer = np.abs(np.linspace(90, -90, H, dtype=np.float32))[:, None]
    b_dno = mix(b_dno, PAL['krzemion'], smoothstep(48, 62, szer) * smoothstep(2000, 3200, gl) * 0.8)
    skal = smoothstep(250, 900, np.abs(rel_mala)) * smoothstep(1500, 2600, gl)               # grzbiety, góry podmorskie
    b_dno = mix(b_dno, PAL['bazalt'], skal * 0.75)
    osad = smoothstep(0, -300, rel_mala) * 0.25                                              # osady w zagłębieniach jaśniej
    b_dno = b_dno * (1.0 + osad[..., None] * 0.5) * (0.8 + 0.4 * sz_b[..., None]) * (0.9 + 0.2 * sz_c[..., None])
    # solniska: wyschnięte baseny i pas wokół szczątkowych mórz (sól wytrąca się przy brzegu)
    sol = np.clip(wyschniete * (0.75 + 0.25 * sz_c) + smoothstep(22.0 / px_km, 4.0 / px_km, dist_woda_px) * 0.85 * (~woda), 0, 1)
    sol = sol * smoothstep(0.3, 0.45, sz_b + 0.15 * sol)
    b_dno = mix(b_dno, PAL['sol'][None, None, :] * (0.9 + 0.12 * sz_c[..., None]), sol * 0.85)
    roz = smoothstep(9.0 / px_km, 1.0 / px_km, dist_woda_px) * (~woda) * smoothstep(0.45, 0.7, sz_b)
    b_dno = mix(b_dno, PAL['solanka_roz'], roz * 0.75)
    b_dno = mix(b_dno, PAL['solanka_poma'], smoothstep(0.62, 0.75, sz_c) * roz * 0.7)
    # dawna linia brzegowa: jasny pas plaży i soli
    brzeg = smoothstep(60, 0, np.abs(e + 18)) * (e < 0)
    b_dno = mix(b_dno, PAL['plaza'], brzeg * 0.55)
    log('dno')

    # ── złożenie: ląd (gdzie obraz ma ląd) / dno / woda ───────────────────────────
    t_lad = smoothstep(-25, 15, e) * (1.0 - img_ocean * smoothstep(40, -10, e))
    kol = mix(b_dno, lad, t_lad)
    # ląd DEM tam, gdzie obraz miał ocean (różnice linii brzegu) — barwa suchego lądu
    kol = mix(kol, PAL['step'][None, None, :] * (0.8 + 0.4 * sz_b[..., None]), np.clip((e > 15) * img_ocean, 0, 1))
    wd = mix(PAL['woda_plytka'][None, None, :] * np.ones((H, W, 1), np.float32), PAL['woda_srednia'], smoothstep(5, 160, glebokosc))
    wd = mix(wd, PAL['woda_gleboka'], smoothstep(250, 1600, glebokosc))
    wd = mix(wd, PAL['glony'], smoothstep(0.58, 0.72, sz_a) * smoothstep(300, 40, glebokosc) * 0.7)
    wd = mix(wd, PAL['solanka_roz'], smoothstep(0.66, 0.78, sz_b) * smoothstep(60, 5, glebokosc) * 0.55)
    t_woda = smoothstep(0, 25, glebokosc) * woda
    kol = mix(kol, wd, t_woda)
    del b_dno, lad, martwe, suchy, wd
    log('złożenie')

    # ── przemysł: huby, odkrywki, kopalnie dna, drogi; światła nocy ──────────────
    noc = np.zeros((H, W, 3), np.float32)
    wys_dod = np.zeros((H, W), np.float32)          # rzeźba przemysłu (m) do normalnych
    stara_noc = luminancja(wczytaj_obraz(os.path.join(KATALOG_REPO, 'public/assets/planety/images/earth_nightmap.jpg'), W, H))
    sn = rozmyj_kula(stara_noc, max(1.0, 25.0 / px_km))
    maks = ndi.maximum_filter(sn, size=max(5, int(260.0 / px_km)), mode=('nearest', 'wrap'))
    kand = np.argwhere((sn == maks) & (sn > np.percentile(sn, 97.5)))
    jasn = sn[kand[:, 0], kand[:, 1]]
    kol_order = np.argsort(-jasn)[:P['huby']]
    huby = []
    for k in kol_order:
        j, i = kand[k]
        lat = 90 - (j + 0.5) / H * 180
        lon = (i + 0.5) / W * 360 - 180
        huby.append((lon, lat, float(jasn[k] / jasn[kol_order[0]])))
    log(f'huby {len(huby)}')

    # resztki dawnych miast nocą (martwe metropolie — pojedyncze światła)
    noc += NOC['ruina'][None, None, :] * (smoothstep(0.08, 0.6, stara_noc) * smoothstep(0.55, 0.8, sz_c) * 0.05)[..., None]

    def strefa(lon0, lat0, b, ziarno):
        """Strefa przemysłu: rozproszone dzielnice zakładów, hałdy, osadniki; nocą siatka świateł i huty."""
        r = 40.0 + 140.0 * b ** 0.6
        rows, cols, x, y = okno(lon0, lat0, r * 1.7, W, H)
        d = np.sqrt(x * x + y * y)
        war = szum2(x, y, 1.0 / 55.0, ziarno) * 0.7 + szum2(x, y, 1.0 / 18.0, ziarno + 1) * 0.3
        m = smoothstep(1.0, 0.6, d / (r * (0.55 + 0.8 * war)))
        # dzielnice: strefa rozpada się na płaty zabudowy z przerwami
        m = m * smoothstep(0.38, 0.55, szum2(x, y, 1.0 / 22.0, ziarno + 2) + 0.25 * (1 - d / r))
        th = ziarno * 0.37
        u = x * math.cos(th) + y * math.sin(th)
        v = -x * math.sin(th) + y * math.cos(th)
        # bloki dwóch rozmiarów (wielkie hale i drobna zabudowa), część pusta (place, składowiska)
        okres = 7.0 + 3.0 * (ziarno % 3)
        blok_d = szum2(np.floor(u / (okres * 2.6)), np.floor(v / (okres * 1.7)), 0.71, ziarno + 9)
        blok_m = szum2(np.floor(u / okres), np.floor(v / okres), 0.73, ziarno + 10)
        blok = np.where(blok_d > 0.6, blok_d, blok_m)
        ulica = np.maximum(smoothstep(0.93, 0.99, np.abs(np.cos(np.pi * u / (okres * 2.6)))),
                           smoothstep(0.93, 0.99, np.abs(np.cos(np.pi * v / (okres * 1.7)))))
        sub = kol[np.ix_(rows, cols)]
        zab = smoothstep(0.32, 0.5, blok)
        jas = 0.62 + 0.55 * smoothstep(0.5, 0.95, blok)
        szary = luminancja(sub)[..., None] * np.array([0.98, 0.98, 1.0], np.float32)
        baza = (sub * 0.35 + szary * 0.65) * (0.55 * jas[..., None]) + PAL['przem'][None, None, :] * 0.25
        baza = mix(sub * 0.82, baza, zab)
        baza = mix(baza, PAL['przem_ciemny'], ulica * 0.35)
        kol[np.ix_(rows, cols)] = sub + (baza - sub) * m[..., None]
        # hałdy i osadniki — wydłużone, stonowane barwy
        for p in range(1 + ziarno % 3):
            a = rng.uniform(0, 2 * math.pi)
            dd = r * rng.uniform(0.7, 1.2)
            rr = rng.uniform(5.0, 14.0) * (0.6 + b)
            px, py = dd * math.cos(a), dd * math.sin(a)
            ka = rng.uniform(0, math.pi)
            ex = (x - px) * math.cos(ka) + (y - py) * math.sin(ka)
            ey = -(x - px) * math.sin(ka) + (y - py) * math.cos(ka)
            dm = np.sqrt((ex / 1.8) ** 2 + ey ** 2) / (rr * (0.8 + 0.4 * szum2(x, y, 1 / 9.0, ziarno + p)))
            mm = smoothstep(1.0, 0.8, dm)
            sub = kol[np.ix_(rows, cols)]
            barwa = (PAL['osad1'], PAL['osad2'], PAL['osad3'], PAL['osad4'])[(ziarno + p) % 4]
            kol[np.ix_(rows, cols)] = sub + (barwa[None, None, :] - sub) * (mm * 0.6)[..., None]
        # noc: światła w zabudowie (gęstsze w środku), ulice, rozżarzone huty
        swiat = m * zab * (0.3 + 0.7 * smoothstep(0.45, 0.9, blok_m)) * (0.4 + 0.8 * b) * (0.5 + 0.5 * smoothstep(1.0, 0.2, d / r))
        sod = NOC['sod'][None, None, :] * (swiat * 0.75 + ulica * m * 0.25)[..., None]
        huta = smoothstep(0.88, 0.96, szum2(x, y, 1 / 6.0, ziarno + 21)) * m * (0.6 + b)
        noc[np.ix_(rows, cols)] += sod + NOC['huta'][None, None, :] * huta[..., None] * 1.3 + NOC['biel'][None, None, :] * (smoothstep(0.3, 0.0, d / r) * 0.3 * b)[..., None]
        return r

    for k, (lon, lat, b) in enumerate(huby):
        if abs(lat) > 72:
            continue
        strefa(lon, lat, b, k + 3)
    log('strefy')

    # kopalnie dna: pola odkrywkowe pasami na dawnych równinach głębinowych
    plaskie = (dno & (gl > 2600) & (np.abs(rel_mala) < 180)).astype(np.float32)
    kand = np.argwhere(plaskie[::7, ::7] > 0) * 7
    pola_dna = []
    for k in rng.choice(len(kand), size=min(P['kopalnie_dna'], len(kand)), replace=False):
        j, i = kand[k]
        lat = 90 - (j + 0.5) / H * 180
        lon = (i + 0.5) / W * 360 - 180
        if abs(lat) > 65:
            continue
        Ld, Wd = rng.uniform(180, 650), rng.uniform(80, 260)
        th = rng.uniform(0, math.pi)
        okres = rng.uniform(14, 26)
        postep = rng.uniform(0.25, 1.0)
        rows, cols, x, y = okno(lon, lat, 0.6 * math.hypot(Ld, Wd) + 10, W, H)
        u = x * math.cos(th) + y * math.sin(th)
        v = -x * math.sin(th) + y * math.cos(th)
        brz = 8.0 * (szum2(x, y, 1 / 30.0, k) - 0.5)
        wn = smoothstep(Ld / 2 + 4, Ld / 2 - 4, np.abs(u) + brz) * smoothstep(Wd / 2 + 4, Wd / 2 - 4, np.abs(v) + brz)
        uz = (u + Ld / 2) / Ld
        wyk = wn * smoothstep(postep + 0.01, postep - 0.01, uz)
        pas = 0.5 + 0.5 * np.cos(2 * np.pi * u / okres)
        b_pas = mix(PAL['odkr_ciemna'][None, None, :] * np.ones(x.shape + (1,), np.float32), PAL['odkr_jasna'], smoothstep(0.3, 0.7, pas))
        sub = kol[np.ix_(rows, cols)]
        kol[np.ix_(rows, cols)] = sub + (b_pas - sub) * (wyk * 0.85)[..., None]
        wys_dod[np.ix_(rows, cols)] += (pas - 0.5) * 220.0 * wyk
        front = wn * smoothstep(0.02, 0.0, np.abs(uz - postep))
        noc[np.ix_(rows, cols)] += NOC['sod'][None, None, :] * (front * 0.9 + wyk * smoothstep(0.93, 0.99, szum2(x, y, 1 / 5.0, k + 77)) * 0.5)[..., None]
        pola_dna.append((lon, lat))
    log(f'kopalnie dna {len(pola_dna)}')

    # odkrywki w górach i na pustyniach
    gory = ((e > 600) & (np.abs(rel_mala) > 150) | ((e > 100) & (zielen < 0.1) & (L > 0.18))) & (lod < 0.2)
    kand = np.argwhere(gory[::5, ::5]) * 5
    odkrywki = []
    for k in rng.choice(len(kand), size=min(P['kopalnie_gor'], len(kand)), replace=False):
        j, i = kand[k]
        lat = 90 - (j + 0.5) / H * 180
        lon = (i + 0.5) / W * 360 - 180
        if abs(lat) > 70:
            continue
        r = rng.uniform(12, 55)
        rows, cols, x, y = okno(lon, lat, r * 1.4, W, H)
        d = np.sqrt(x * x + (y * rng.uniform(0.7, 1.3)) ** 2) / (r * (0.85 + 0.3 * szum2(x, y, 1 / 15.0, k + 5)))
        m = smoothstep(1.0, 0.92, d)
        stopnie = 0.5 + 0.5 * np.cos(d * 7 * 2 * np.pi)
        b_o = mix(PAL['odkr_jasna'][None, None, :] * np.ones(x.shape + (1,), np.float32), PAL['odkr_ciemna'], smoothstep(0.5, 0.0, d) * 0.8)
        b_o = b_o * (0.85 + 0.25 * stopnie[..., None])
        sub = kol[np.ix_(rows, cols)]
        kol[np.ix_(rows, cols)] = sub + (b_o - sub) * (m * 0.9)[..., None]
        wys_dod[np.ix_(rows, cols)] -= (1 - np.clip(d, 0, 1)) * 900.0 * m
        noc[np.ix_(rows, cols)] += NOC['sod'][None, None, :] * (m * smoothstep(0.9, 0.99, stopnie) * 0.25 + smoothstep(0.25, 0.0, d) * 0.4)[..., None]
        odkrywki.append((lon, lat))
    log(f'odkrywki {len(odkrywki)}')

    # drogi i koleje: drzewo rozpinające hubów i kopalń + skróty
    wezly = [(lo, la) for lo, la, _ in huby if abs(la) < 72] + pola_dna[::2] + odkrywki[::3]
    xyz = np.array([kierunek_z_lonlat(lo, la) for lo, la in wezly])
    kat = np.arccos(np.clip(xyz @ xyz.T, -1, 1))
    from scipy.sparse.csgraph import minimum_spanning_tree
    mst = minimum_spanning_tree(kat).toarray()
    krawedzie = set((a, b) for a, b in zip(*np.nonzero(mst)) if kat[a, b] < 1600.0 / R_ZIEMI_KM)
    for a in range(len(wezly)):
        for b in np.argsort(kat[a])[1:3]:
            if kat[a, b] < 1100.0 / R_ZIEMI_KM:
                krawedzie.add((min(a, b), max(a, b)))
    droga = np.zeros((H, W), np.float32)
    for a, b in krawedzie:
        A, B = xyz[a], xyz[b]
        om = kat[a, b]
        if om < 1e-4 or om > 3500.0 / R_ZIEMI_KM:
            continue
        n_s = int(om * R_ZIEMI_KM / (px_km * 0.35)) + 2
        t = np.linspace(0, 1, n_s)
        so = math.sin(om)
        pts = (np.sin((1 - t) * om)[:, None] * A + np.sin(t * om)[:, None] * B) / so
        # lekkie meandry
        wob = (np.sin(t * om * R_ZIEMI_KM / 140.0 + a) * 0.6 + np.sin(t * om * R_ZIEMI_KM / 57.0 + b) * 0.3) * 12.0 / R_ZIEMI_KM
        prost = np.cross(A, B)
        prost /= np.linalg.norm(prost) + 1e-9
        pts = pts + prost[None, :] * (wob * np.sin(np.pi * t))[:, None]
        pts /= np.linalg.norm(pts, axis=1, keepdims=True)
        lat = np.arcsin(np.clip(pts[:, 2], -1, 1))
        lon = np.arctan2(pts[:, 1], pts[:, 0])
        fi = (lon + np.pi) / (2 * np.pi) * W - 0.5
        fj = (np.pi / 2 - lat) / np.pi * H - 0.5
        i0 = np.floor(fi).astype(int)
        j0 = np.floor(fj).astype(int)
        wi, wj = fi - i0, fj - j0
        for di, dj, w in ((0, 0, (1 - wi) * (1 - wj)), (1, 0, wi * (1 - wj)), (0, 1, (1 - wi) * wj), (1, 1, wi * wj)):
            jj = np.clip(j0 + dj, 0, H - 1)
            np.maximum.at(droga, (jj, (i0 + di) % W), w.astype(np.float32))
    droga = np.clip(droga * 1.6, 0, 1) * (1 - woda)
    kol = mix(kol, PAL['droga'], droga * 0.45)
    przer = smoothstep(0.62, 0.8, pole_szumu(W, H, lambda x, y, z: szum3(x * 2600.0, y * 2600.0, z * 2600.0, 99)))
    noc += NOC['sod'][None, None, :] * (droga * (0.03 + 0.4 * przer))[..., None]
    log(f'drogi {len(krawedzie)}')

    # posterunki robotów: rozsiane pojedyncze światła na lądzie i dnie (gęściej w pasach przemysłu)
    gest = smoothstep(0.35, 0.75, sz_a) * (1 - woda) * (1 - lod) * (np.abs(np.linspace(90, -90, H))[:, None] < 72)
    los = rng.random((H, W), dtype=np.float32)
    pkt = (los > 1.0 - 0.0016 * (2048.0 / W) ** 2 * (0.25 + 2.5 * gest)).astype(np.float32)
    pkt = np.clip(rozmyj_kula(pkt, 0.6) * 4.0, 0, 1) * (0.25 + 0.75 * rng.random((H, W), dtype=np.float32))
    pkt *= (1 - woda) * (1 - lod)
    noc += (NOC['sod'] * 0.7 + NOC['zimna'] * 0.3)[None, None, :] * (pkt * 0.5)[..., None]
    del los

    # ── wielka kopalnia ringu ─────────────────────────────────────────────────────
    pit = dziura.parametry()
    kol, noc, wys_pit, pit_maska = dziura.wypiecz(pit, kol, noc, W, H, R_ZIEMI_KM)
    log('dziura')

    # ── chmury: rzadkie układy, pył i burze piaskowe ──────────────────────────────
    ch_old = wczytaj_szary(os.path.join(KATALOG_REPO, 'public/assets/planety/solar/earth/earth_clouds.jpg'), W, H)
    chmury = smoothstep(0.42, 0.95, ch_old) * 0.8
    sucho = np.clip((dno | (zielen < 0.15) & (e > 0)).astype(np.float32) * (1 - woda) * (1 - lod), 0, 1)
    sucho = rozmyj_kula(sucho, max(1.0, 300.0 / px_km))
    pyl_pole = pole_szumu(W, H, lambda x, y, z: fbm3(x + 0.35 * fbm3(x, y, z, 2.5, 2, 41), y, z, 2.2, 6, 40))
    pyl = smoothstep(0.5, 0.82, pyl_pole) * sucho * 0.32
    burze = np.zeros((H, W), np.float32)
    # burze pyłowe: łukowe fronty (haboob) z ciągnącą się smugą, kilka nad suchymi równinami
    kand = np.argwhere((sucho[::9, ::9] > 0.7)) * 9
    for k in rng.choice(len(kand), size=min(9, len(kand)), replace=False):
        j, i = kand[k]
        lat = 90 - (j + 0.5) / H * 180
        lon = (i + 0.5) / W * 360 - 180
        if abs(lat) > 60:
            continue
        R = rng.uniform(350, 800)
        rows, cols, x, y = okno(lon, lat, R * 1.3, W, H)
        th = rng.uniform(0, 2 * math.pi)
        u = x * math.cos(th) + y * math.sin(th)
        v = -x * math.sin(th) + y * math.cos(th)
        # front = łuk; za nim smuga rozrzedzająca się do tyłu, prążki wzdłuż frontu
        front = u - R * 0.55 + (v * v) / (R * 1.4)
        war = szum2(u / 1.0, v / 1.0, 1.0 / 60.0, k + 70)
        cien = smoothstep(-R * 0.9, -R * 0.05, front + (war - 0.5) * R * 0.25) * smoothstep(R * 0.02, -R * 0.06, front + (war - 0.5) * R * 0.1)
        prazki = szum2(u / 5.0, v / 1.0, 1.0 / 14.0, k + 71)
        bok = smoothstep(R * 1.05, R * 0.5, np.abs(v))
        g = cien * bok * (0.55 + 0.6 * prazki) * smoothstep(0.0, 0.25, cien)
        sub = burze[np.ix_(rows, cols)]
        burze[np.ix_(rows, cols)] = np.maximum(sub, np.clip(g, 0, 1) * 0.85)
    pyl = np.clip(pyl + burze, 0, 1)
    barwa_pylu = kolor('#b89a74')
    m_ch = np.clip(chmury + pyl * (1 - chmury), 0, 1)
    rgb_ch = (np.ones(3, np.float32)[None, None, :] * chmury[..., None] + barwa_pylu[None, None, :] * (pyl * (1 - chmury))[..., None]) / np.maximum(m_ch, 1e-4)[..., None]
    chm_srgb = lin_do_srgb(rgb_ch) * m_ch[..., None]          # luminancja ≈ maska, chroma = barwa pyłu
    log('chmury')

    # ── normalne ──────────────────────────────────────────────────────────────────
    h = np.where(woda, np.float32(S), e).astype(np.float32) + wys_dod + wys_pit
    h = np.where(lod > 0.5, rozmyj_kula(h, 1.0), h)
    nrm = normalne_z_wysokosci(h, R_ZIEMI_KM * 1000.0, P['przewyzszenie'])
    nrm[pit_maska] = (0.0, 0.0, 1.0)                      # bryłę dziury rysuje geometria
    log('normalne')

    # ── zapis ─────────────────────────────────────────────────────────────────────
    kol_srgb = lin_do_srgb(kol)
    noc_srgb = lin_do_srgb(np.clip(noc, 0, 1))
    spec = np.clip(t_woda, 0, 1).astype(np.float32)
    pliki = {
        'earth_hf_color.jpg': (kol_srgb, 92),
        'earth_hf_night.jpg': (noc_srgb, 92),
        'earth_hf_clouds.jpg': (chm_srgb, 90),
        'earth_hf_water.jpg': (spec, 90),
    }
    for nazwa, (a, q) in pliki.items():
        zapisz_rgb(os.path.join(wyj, nazwa), a, q)
    zapisz_normalne(os.path.join(wyj, 'earth_hf_normal.jpg'), nrm, 95)
    for nazwa, a in (('kolor', kol_srgb), ('noc', noc_srgb), ('chmury', chm_srgb), ('normalne', nrm * 0.5 + 0.5)):
        podglad(os.path.join(podglady, f'ziemia-{nazwa}.png'), a)
    log(f'zapis → {wyj}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--szer', type=int, default=2048)
    ap.add_argument('--do-gry', action='store_true', help='zapis do public/assets/planety/solar/earth/')
    ap.add_argument('--wyj', default=None)
    a = ap.parse_args()
    W, H = a.szer, a.szer // 2
    wyj = os.path.join(KATALOG_REPO, 'public', 'assets', 'planety', 'solar', 'earth') if a.do_gry else (a.wyj or os.path.join(KATALOG_REPO, '.tmp', 'planety', f'ziemia-{W}'))
    generuj(W, H, wyj, os.path.join(KATALOG_REPO, '.tmp', 'planety', f'podglad-{W}'), a.do_gry)


if __name__ == '__main__':
    main()
