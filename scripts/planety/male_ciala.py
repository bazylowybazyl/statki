# -*- coding: utf-8 -*-
"""Generator map MAŁYCH CIAŁ (HULLFALL): Ceres, Westa, Pallas, Hygiea, Psyche, Pluton, Charon — strumień C planu
docs/PLAN-pas-realizm.md (2026-10-12). Każde ciało z rolą w grze (src/data/smallBodies.js):

  ceres    STOLICA UNII PASA: miasto wokół krateru Occator (plamy soli Cerealia i Vinalia zostają nietknięte),
           port, stocznia (suche doki), huta i zakłady elektroniki, kopalnie lodu przy biegunach, placówki, drogi;
           nocą chłodna biel i cyjan Unii, ciepłe okna miasta, bursztynowe znaki (barwa frakcji)
  westa    HUTA UNII: odkrywki żelaza i tytanu, piece i żużel przy rowach Divalia Fossae, krótki tor wyrzutni
           masy, port; nocą sód i żar hut, cyjan Unii w znakach; basen Rheasilvia (biegun płd.) z modelu Dawn
  pallas   typ B — szaroniebieskawa „piłka golfowa” (VLT): ~37 kraterów > 30 km, basen ~400 km wzdłuż równika
           i drugi mniejszy, jasna plama (osady soli w kraterze) na półkuli płd.; rozproszone placówki górnicze Unii
  hygiea   typ C — prawie kulista, ciemna i gładka, kratery Romulus i Remus; posterunki lodowe Unii
  psyche   typ M — metaliczna, bliska elipsoidzie Jacobiego (278 × 238 × 171 km), zagłębienia Meroe i Panthia
           (~90 km); odkrywki metalu Unii
  pluton   New Horizons: „serce” (Sputnik Planitia, Tombaugh Regio), Cthulhu; niczyj — noc czarna
  charon   New Horizons: szary lód, czerwona czapa Mordor Macula; noc czarna

Wejście (domena publiczna, USGS Astrogeology — planetarymaps.usgs.gov/mosaic/, pobierane raz do .tmp/planety-dane/<ciało>/):
  ceres/Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif              Dawn FC, mozaika 400 m/px (0–360° E)
  ceres/Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016.tif     Dawn HAMO, wysokość (int16 m nad kulą 470 km, 0–360° E)
  westa/Vesta_Dawn_FC_HAMO_Mosaic_Global_74ppd.tif              Dawn FC HAMO, mozaika 60 m/px (−180–180°)
  westa/Vesta_Dawn_HAMO_DTM_DLR_Global_48ppd.tif                Dawn HAMO, promień bryły [m] (float32, −180–180°)
  pluton/Pluto_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif  New Horizons (0–360° E; półkula płd. bez danych)
  charon/Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif New Horizons (−180–180°; półkula płd. bez danych)
Pallas, Hygiea, Psyche — map globalnych nie ma: proceduralnie wg typu, osi z pomiarów (VLT SPHERE, radar) i cech.

Wyjście: public/assets/planety/solar/small/<plik>_hf_{color,night,normal}.jpg (równoodległe, kolumna 0 = 180° W)
i <plik>_hf_shape.png (bez Plutona i Charona — kule) — PROMIEŃ bryły względem średniego, d = r / R − 1, 512 × 256,
16 bitów: R = starszy bajt, G = młodszy; zakres d per ciało w bloku /*SMALL_BODY_SHAPE*/ src/3d/planetMaps.js (ten sam
blok czyta gra). Siatkę kuli przesuwa gra (planet3d.assets.js: DirectSmallBody). Mapa normalnych Ceres i Westy niesie
tylko drobną rzeźbę DTM (górnoprzepustowo — duże formy są w bryle, inaczej cieniowałyby się podwójnie); ciała
proceduralne mają duże formy tylko w bryle, a kratery tylko w normalnych — bez filtra (`Cialo.gorne`).

  .tmp/venv-planety/Scripts/python -I scripts/planety/male_ciala.py --cialo ceres              # podgląd 2048
  .tmp/venv-planety/Scripts/python -I scripts/planety/male_ciala.py --cialo wszystkie --do-gry
"""
import argparse
import json
import math
import os
import sys
from contextlib import contextmanager

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from wspolne import *  # noqa: E402,F401,F403
from infrastruktura import linia, szum2  # noqa: E402
import ksiezyce as K  # noqa: E402

CIALA = ('ceres', 'westa', 'pallas', 'hygiea', 'psyche', 'pluton', 'charon')
PLIK = dict(ceres='ceres', westa='vesta', pallas='pallas', hygiea='hygiea', psyche='psyche', pluton='pluto', charon='charon')
R_KM = dict(ceres=469.7, westa=262.7, pallas=256.0, hygiea=216.5, psyche=111.0, pluton=1188.3, charon=606.0)
# Rozdzielczość gry (promień w grze z src/data/smallBodies.js: Ceres 4 717 j., Pluton 7 503 j. → 4096 = 7–12 j. na teksel,
# reszta 2 300–5 400 j. → 2048 = 7–16 j. na teksel; Luna 4096 ma 14)
GRA_SZER = dict(ceres=4096, westa=2048, pallas=2048, hygiea=2048, psyche=2048, pluton=4096, charon=2048)
KSZTALT_W = 512
# siatka w grze 256 × 128 oczek: rzeźba szersza niż ~1,2 oczka idzie w bryłę, węższa w mapę normalnych
SIATKA_OCZKA = 256
PRZEWYZSZENIE = dict(ceres=1.6, westa=1.3, pallas=2.6, hygiea=2.0, psyche=2.2, pluton=1.8, charon=1.8)
# Średnia jasność liniowa map dnia (ważona polem). Względem albedo (Ceres 0,09, Hygiea 0,07 — ciemne; Pallas, Psyche
# 0,15; Westa 0,42; Charon 0,38; Pluton 0,52) ściśnięte pierwiastkiem jak księżyce (ksiezyce.py: JASNOSC)
JASNOSC = dict(ceres=0.19, westa=0.36, pallas=0.21, hygiea=0.16, psyche=0.23, pluton=0.33, charon=0.31)
ZRODLA = dict(
    ceres=('ceres/Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif', 'ceres/Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016.tif'),
    westa=('westa/Vesta_Dawn_FC_HAMO_Mosaic_Global_74ppd.tif', 'westa/Vesta_Dawn_HAMO_DTM_DLR_Global_48ppd.tif'),
    pluton=('pluton/Pluto_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif', None),
    charon=('charon/Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif', None),
)
# osie [km] (średnice a, b, c) brył proceduralnych — Pallas, Hygiea: VLT SPHERE (Marsset 2020, Vernazza 2019), Psyche: radar
OSIE_KM = dict(pallas=(569.0, 525.0, 500.0), hygiea=(450.0, 430.0, 424.0), psyche=(278.0, 238.0, 171.0))
# promień [km], od którego krater jest złożony (płaskie dno, górka, tarasy): Księżyc ~9 km przy 1,62 m/s², próg ∝ 1 / g —
# Pallas g ≈ 0,21 m/s² → ~70 km, Hygiea ≈ 0,12 → ~120, Psyche ≈ 0,12 → ~115 (masy: 2,04e20 / 8,3e19 / 2,3e19 kg)
R_ZLOZONY = dict(pallas=70.0, hygiea=120.0, psyche=115.0)
ZAKRES_KSZTALTU = wczytaj_json_z_js(os.path.join(KATALOG_REPO, 'src', '3d', 'planetMaps.js'), 'SMALL_BODY_SHAPE')

NOC = dict(K.NOC)
NOC.update({k: kolor(v) for k, v in dict(up_bursz='#ffc34d', okna='#ffdcae', chlod='#e3f4ff').items()})


# ── Stan jednego ciała ─────────────────────────────────────────────────────────
class Cialo(K.Mapa):
    """Mapa księżyca (ksiezyce.py: barwa, noc, wysokość, miejsca) + kształt bryły (d = r / R − 1, KSZTALT_W × /2)."""
    def __init__(self, cialo, W, H, ziarno):
        K.R_KM.setdefault(cialo, R_KM[cialo])
        super().__init__(cialo, W, H, ziarno)
        self.ksztalt = None
        # Mapa normalnych górnoprzepustowo (duże formy niesie bryła): ciała z modeli Dawn — M.h to cała rzeźba z DTM.
        # Ciała proceduralne mają duże formy (elipsoida, garby, baseny) TYLKO w bryle, a kratery tylko w M.h — bez
        # filtra: misa krateru zostaje w normalnych (filtr zostawiał z niej płaskie dno i ostry wał — „talerz”,
        # a siatka 256 × 128 nie oddaje misy kilku oczek).
        self.gorne = cialo not in R_ZLOZONY

    def sigma_bryly_px(self):
        """Rozmycie oddzielające bryłę (siatka gry) od mapy normalnych [px mapy]."""
        oczko_km = 2 * math.pi * self.R / SIATKA_OCZKA
        return max(1.0, 1.2 * oczko_km / self.px_km)


@contextmanager
def swiatla_odkrywki(**zamiany):
    """ksiezyce.odkrywka świeci barwami NOC['sod' | 'biel' | 'huta'] — tu podmiana na paletę ciała."""
    stare = {k: K.NOC[k] for k in zamiany}
    K.NOC.update({k: NOC[v] for k, v in zamiany.items()})
    try:
        yield
    finally:
        K.NOC.update(stare)


# ── Wczytanie danych ───────────────────────────────────────────────────────────
def _tif(sciezka):
    import tifffile
    with tifffile.TiffFile(os.path.join(KATALOG_DANYCH, sciezka)) as tf:
        return tf.pages[0].asarray()


def zmniejsz(a, W, wazne):
    """Średnia z ważnych próbek w blokach k × k (k = szer // 2W) → (wartość, udział ważnych). `wazne(blok, wiersz0, H0)`."""
    H0, W0 = a.shape
    k = max(1, W0 // (2 * W))
    h, w = H0 // k, W0 // k
    s = np.zeros((h, w), np.float32)
    c = np.zeros((h, w), np.float32)
    for j in range(0, h, 128):
        nb = min(128, h - j)
        blk = a[j * k:(j + nb) * k, :w * k].astype(np.float32)
        ok = wazne(blk, j * k, H0)
        blk = np.where(ok, blk, 0.0)
        s[j:j + nb] = blk.reshape(nb, k, w, k).sum(axis=(1, 3))
        c[j:j + nb] = ok.reshape(nb, k, w, k).sum(axis=(1, 3))
    return s / np.maximum(c, 1.0), c / float(k * k)


def wczytaj_mozaike(cialo, W, H, przesun, wazne):
    """Mozaika uint8 → jasność [0, 1] i waga ważności (H, W) w konwencji gry (kolumna 0 = 180° W)."""
    cache = os.path.join(KATALOG_DANYCH, cialo, f'mala_mozaika_{W}.npz')
    if os.path.exists(cache):
        z = np.load(cache)
        return z['v'], z['w']
    a = _tif(ZRODLA[cialo][0])
    v, w = zmniejsz(a, W, wazne)
    del a
    v = np.clip(przeskaluj(v / 255.0, W, H), 0, 1)
    w = np.clip(przeskaluj(w, W, H), 0, 1)
    if przesun:                                            # 0–360° E → −180–180°
        v, w = np.roll(v, W // 2, axis=1), np.roll(w, W // 2, axis=1)
    np.savez(cache, v=v.astype(np.float32), w=w.astype(np.float32))
    return v, w


def wczytaj_promien(cialo, W, H, przesun, baza_m):
    """Model wysokości Dawn → promień bryły [m] (H, W)."""
    cache = os.path.join(KATALOG_DANYCH, cialo, f'mala_promien_{W}.npz')
    if os.path.exists(cache):
        return np.load(cache)['r']
    a = _tif(ZRODLA[cialo][1])
    r, _ = zmniejsz(a, W, lambda b, j0, H0: np.isfinite(b) & (b > -1e30))
    del a
    r = przeskaluj(r + baza_m, W, H)
    if przesun:
        r = np.roll(r, W // 2, axis=1)
    np.savez(cache, r=r.astype(np.float32))
    return r


def szerokosci(H):
    return np.linspace(90 - 90 / H, -90 + 90 / H, H, dtype=np.float32)[:, None]


def dlugosci(W):
    return np.linspace(-180 + 180 / W, 180 - 180 / W, W, dtype=np.float32)[None, :]


def odleglosc_kat(lon, lat, lon0, lat0):
    """Odległość kątowa [°] pól (lon, lat) od punktu."""
    a = np.radians(lat) ; b = math.radians(lat0)
    c = np.sin(a) * math.sin(b) + np.cos(a) * math.cos(b) * np.cos(np.radians(lon - lon0))
    return np.degrees(np.arccos(np.clip(c, -1, 1)))


# ── Bryła ─────────────────────────────────────────────────────────────────────
def ksztalt_z_promienia(M, r_m):
    d = r_m / (M.R * 1000.0) - 1.0
    return przeskaluj(rozmyj_kula(d, max(1.0, 0.6 * M.W / KSZTALT_W)), KSZTALT_W, KSZTALT_W // 2)


def ksztalt_elipsoidy(osie_km, R_km, odksztalcenie=0.0, ziarno=0):
    """Promień trójosiowej elipsoidy (a: 0°, b: 90° E, c: biegun) względem R, + nieregularność (fbm, ułamek R)."""
    W, Hs = KSZTALT_W, KSZTALT_W // 2
    a, b, c = (q / 2.0 for q in osie_km)
    x, y, z = kierunki(W, Hs)
    r = 1.0 / np.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2)
    d = r / R_km - 1.0
    if odksztalcenie:
        d = d + (fbm3(x, y, z, 1.6, 4, ziarno) - 0.5) * 2.0 * odksztalcenie
    return d.astype(np.float32)


def okno_kuli(lon0, lat0, r_km, W, H, R_km):
    """Okno wokół punktu w rzucie azymutalnym równoodległościowym: x (wschód), y (północ) w km po kole wielkim —
    okrąg na kuli zostaje okręgiem także przy biegunie (okno sinusoidalne `infrastruktura.okno` ciągnęło tam kratery
    w łuki przez pół mapy). Wiersze i kolumny = dokładny zasięg czaszy (z biegunem — wszystkie kolumny)."""
    a = min(r_km / R_km, math.pi)
    phi0, lam0 = math.radians(lat0), math.radians(lon0)
    j0 = max(0, int((math.pi / 2 - (phi0 + a)) / math.pi * H) - 1)
    j1 = min(H, int((math.pi / 2 - (phi0 - a)) / math.pi * H) + 2)
    rows = np.arange(j0, j1)
    if phi0 + a >= math.pi / 2 or phi0 - a <= -math.pi / 2:
        cols = np.arange(W)
    else:
        dlon = math.asin(min(1.0, math.sin(a) / math.cos(phi0)))
        i_c = (lam0 + math.pi) / (2 * math.pi) * W
        di = int(dlon / (2 * math.pi) * W) + 2
        cols = np.arange(W) if 2 * di + 1 >= W else np.arange(int(i_c) - di, int(i_c) + di + 1) % W
    lon = (cols + 0.5) / W * 2 * np.pi - np.pi
    lat = np.pi / 2 - (rows + 0.5) / H * np.pi
    dl = ((lon - lam0 + np.pi) % (2 * np.pi) - np.pi)[None, :]
    sp, cp = np.sin(lat)[:, None], np.cos(lat)[:, None]
    e = cp * np.sin(dl)                                           # składowe kierunku w płaszczyźnie stycznej
    n = math.cos(phi0) * sp - math.sin(phi0) * cp * np.cos(dl)
    c = np.arccos(np.clip(math.sin(phi0) * sp + math.cos(phi0) * cp * np.cos(dl), -1.0, 1.0))
    k = R_km * c / np.maximum(np.sqrt(e * e + n * n), 1e-12)
    return rows, cols, (e * k).astype(np.float32), (n * k).astype(np.float32)


def kontur(x, y, r, ziarno, sila=0.1):
    """Odległość względna od środka z nieregularnym brzegiem (dwie częstości szumu: wieloboczny zarys, drobne wcięcia)."""
    d = np.sqrt(x * x + y * y) / r
    return d * (1.0 + sila * (szum2(x, y, 1 / (r * 0.45), ziarno) - 0.5) + 0.25 * sila * (szum2(x, y, 1 / (r * 0.2), ziarno + 5) - 0.5))


def basen(M, lon, lat, r_km, glab_m, ziarno, wal=0.12, gorka=0.0, barwa=None, sila=0.0):
    """Wielki basen: misa w bryle (kształt), wał w mapie wysokości, opcjonalnie wypiętrzenie centralne (ułamek głębi)
    i inna barwa dna (`barwa`, `sila` — np. ciemniejsze / jaśniejsze jednostki albedo)."""
    Hs = KSZTALT_W // 2
    rows, cols, x, y = okno_kuli(lon, lat, r_km * 1.8, KSZTALT_W, Hs, M.R)
    d = kontur(x, y, r_km, ziarno, 0.14)
    misa = -glab_m * smoothstep(1.0, 0.0, d) ** 1.4 + glab_m * wal * np.exp(-((d - 1.0) / 0.18) ** 2)
    if gorka:
        misa = misa + glab_m * gorka * np.exp(-(d / 0.22) ** 2)
    M.ksztalt[np.ix_(rows, cols)] += (misa / (M.R * 1000.0)).astype(np.float32)
    rows, cols, x, y = okno_kuli(lon, lat, r_km * 1.8, M.W, M.H, M.R)
    d = kontur(x, y, r_km, ziarno, 0.14)
    M.wysokosc(rows, cols, (glab_m * wal * 1.5 * np.exp(-((d - 1.0) / 0.11) ** 2)).astype(np.float32))
    if barwa is not None and sila:
        t = smoothstep(1.15, 0.55, d + 0.25 * (szum2(x, y, 1 / (r_km * 0.2), ziarno + 9) - 0.5)) * sila
        M.mieszaj(rows, cols, barwa, t.astype(np.float32))


# ── Kratery (bryły proceduralne) ──────────────────────────────────────────────
def kratery_losowe(rng, n, r_min, r_max, wykladnik=2.0):
    """Rozkład potęgowy N(> r) ∝ r^−wykładnik, kierunki równomiernie po kuli, wiek 0 (świeży) … 1 (zatarty)."""
    u = rng.random(n)
    a = (r_min / r_max) ** wykladnik
    r = r_min * (1.0 - u * (1.0 - a)) ** (-1.0 / wykladnik)
    lon = rng.uniform(-180, 180, n)
    lat = np.degrees(np.arcsin(rng.uniform(-1, 1, n)))
    wiek = rng.random(n) ** 0.55
    order = np.argsort(-r)                                 # najpierw duże (małe nakładają się na nie)
    return [(float(lon[i]), float(lat[i]), float(r[i]), float(wiek[i])) for i in order]


def promienie_krateru(x, y, d, r, r_px, ziarno):
    """Jasność wyrzutu świeżego krateru (0…1): ciągły koc przy wale o poszarpanym brzegu, a w kraterach większych niż
    kilka pikseli mapy — wąskie promienie różnej długości (1,6–5 r) rwące się w łańcuchy plam (wtórne kratery), coraz
    słabsze z odległością. Kąt przez (cos, sin) — szum na okręgu nie ma szwu przy ±180° (arctan2 wprost zostawiał
    rysę); małe kratery bez promieni (kilka pikseli promieni czytało się jak gwiazdka albo jeżowiec)."""
    th = np.arctan2(y, x)
    c, s = np.cos(th), np.sin(th)
    z0 = np.full_like(c, ziarno * 0.371)
    plamki = smoothstep(0.25, 0.75, szum2(x, y, 1 / max(r * 0.35, 0.3), ziarno + 3))
    brzeg = 1.45 + 0.5 * (szum3(c * 3.0, s * 3.0, z0 + 2.0, ziarno + 31) - 0.5)          # zasięg koca [r] wg kierunku
    koc = smoothstep(brzeg, 0.95, d) * (0.55 + 0.45 * plamki)
    sila_promieni = smoothstep(5.0, 14.0, r_px)
    if sila_promieni <= 0.0:
        return np.clip(koc * 0.7, 0.0, 1.0)
    smugi = smoothstep(0.55, 0.8, szum3(c * 9.0, s * 9.0, z0 + d * 0.12, ziarno + 9))       # ~15 wąskich promieni
    lancuch = smoothstep(0.3, 0.7, szum3(c * 9.0 + 40.0, s * 9.0, z0 + d * 1.8, ziarno + 41))  # rwanie wzdłuż promienia
    dlug = 1.6 + 3.4 * szum3(c * 2.2, s * 2.2, z0 + 5.0, ziarno + 21)                        # długość [r] wg kierunku
    zanik = np.clip((dlug - d) / np.maximum(dlug - 1.0, 0.3), 0.0, 1.0) ** 1.5 * smoothstep(0.8, 1.15, d)
    return np.clip(koc * 0.7 + smugi * lancuch * zanik * (0.3 + 0.7 * plamki) * 0.8 * sila_promieni, 0.0, 1.0)


def krater(M, lon, lat, r, wiek, PAL, ziarno, glab_k=1.0, r_zlozony=None):
    """Krater: misa (prosta, a od r > `r_zlozony` złożona: płaskie dno, górka centralna, tarasy), wał, wyrzut;
    świeży — jaśniejszy wyrzut i ściany (ton PAL['swiezy']) z promieniami, stary — wał i misa zatarte. Wysokość →
    M.h (normalne), duże też do bryły. Okna po kole wielkim (`okno_kuli`) — kratery przy biegunach bez rozciągania.
    Próg krateru złożonego rośnie odwrotnie do grawitacji (Księżyc: średnica ~18 km przy 1,62 m/s²): na Pallas,
    Hygiei i Psyche (0,1–0,2 m/s²) wszystkie kratery mniejsze od basenów są prostymi misami — płaskie dna z górką
    wyglądały tam jak talerze."""
    r_px = r / M.px_km
    zasieg = 5.2 if (wiek < 0.25 and r_px > 5.0) else 2.6
    rows, cols, x, y = okno_kuli(lon, lat, r * zasieg, M.W, M.H, M.R)
    d = np.sqrt(x * x + y * y) / r * (1.0 + 0.08 * (szum2(x, y, 1 / max(r * 0.45, 0.5), ziarno) - 0.5))
    r_zlozony = R_ZLOZONY.get(M.cialo, 10.0) if r_zlozony is None else r_zlozony
    zlozony = r > r_zlozony
    glab = r * 1000.0 * 0.2 * min(1.0, (r_zlozony / r) ** 0.45) * (1.0 - 0.6 * wiek) * glab_k
    misa = -glab * (1.0 - np.minimum(d, 1.0) ** 2)
    if zlozony:
        # płaskie dno gładkim maksimum (ostre max zostawiało pierścień na mapie normalnych)
        dno, k = -glab * 0.72, glab * 0.25
        hh = np.maximum(k - np.abs(misa - dno), 0.0) / k
        misa = np.maximum(misa, dno) + hh * hh * k * 0.25
        misa += glab * 0.32 * np.exp(-(d / 0.14) ** 2)     # górka centralna
        if r > 14.0 and wiek < 0.75:
            # tarasy ściany wewnętrznej (osuwiska krateru złożonego): 3 stopnie, przerywane i nierówne (szum przesuwa
            # krawędź stopnia — równe pierścienie wyglądały jak fala na wodzie), zatarte z wiekiem
            n_t = 3.0
            rwanie = 0.22 * (szum2(x, y, 1 / max(r * 0.18, 0.5), ziarno + 13) - 0.5)
            u = np.clip((d - 0.55) / 0.43 + rwanie, 0.0, 1.0) * n_t
            stopnie = (np.floor(u) + smoothstep(0.7, 1.0, u - np.floor(u))) / n_t
            sciana = smoothstep(0.5, 0.6, d) * smoothstep(1.0, 0.95, d)
            ciaglosc = smoothstep(0.3, 0.6, szum2(x, y, 1 / max(r * 0.3, 0.5), ziarno + 17))
            misa = misa + (stopnie - u / n_t) * glab * 0.35 * sciana * ciaglosc * (1.0 - wiek)
    wal = glab * 0.24 * (1.0 - 0.7 * wiek) * np.exp(-((d - 1.0) / 0.14) ** 2)
    wyrzut = np.where(d > 1.0, glab * 0.06 * np.exp(-(d - 1.0) / 0.45), 0.0)
    h = (misa + wal + wyrzut).astype(np.float32)
    M.wysokosc(rows, cols, h)
    # albedo: dno ciemniej (zawsze, słabiej w starych), wał jaśniej, świeży — jasny wyrzut z promieniami
    M.mieszaj(rows, cols, PAL['dno'], (smoothstep(0.95, 0.3, d) * (0.22 - 0.1 * wiek)).astype(np.float32))
    # jasny wał tylko w młodszych kraterach (w zatartych zostawał jasny pierścień jak bańka)
    M.mieszaj(rows, cols, PAL['swiezy'], (np.exp(-((d - 1.0) / 0.12) ** 2) * 0.16 * (1.0 - wiek) ** 2).astype(np.float32))
    if wiek < 0.25:
        s = 1.0 - wiek / 0.25
        jasno = promienie_krateru(x, y, d, r, r_px, ziarno) * 0.4 * s
        M.mieszaj(rows, cols, PAL['swiezy'], jasno.astype(np.float32))
    # bryła: duże kratery (szersze niż ~2 oczka siatki) — tylko gdy normalne są górnoprzepustowe (inaczej misa liczyłaby
    # się dwa razy: w siatce i w mapie normalnych)
    if M.gorne and r > 2.2 * (2 * math.pi * M.R / SIATKA_OCZKA):
        Hs = KSZTALT_W // 2
        rr, cc, xs, ys = okno_kuli(lon, lat, r * 1.6, KSZTALT_W, Hs, M.R)
        ds = np.sqrt(xs * xs + ys * ys) / r
        # w bryle gładka misa (zerowe nachylenie przy wale) — misa 1 − d² urywała się przy d = 1 ze spadkiem 2·głębi:
        # ostra krawędź siatki dawała w cieniowaniu jaśniejszy / ciemniejszy „krążek”; ostry wał niesie mapa normalnych
        hs = -glab * smoothstep(1.05, 0.0, ds) ** 1.3 * (0.72 if zlozony else 1.0) + glab * 0.15 * np.exp(-((ds - 1.0) / 0.3) ** 2)
        M.ksztalt[np.ix_(rr, cc)] += (hs / (M.R * 1000.0)).astype(np.float32)


def garby(M, n, amp, sigma_deg, ziarno, dodatnie=0.5):
    """Nieregularność bryły: n garbów i wgnieceń (gauss po kącie na kuli) — d += ±amp_i · exp(−(kąt / σ_i)²).
    Duże ciała bez rozpoznanych map nie są elipsoidami: zrosty po zderzeniach, odłamane płaty, wypiętrzenia."""
    Hs = KSZTALT_W // 2
    x, y, z = kierunki(KSZTALT_W, Hs)
    rng = np.random.default_rng(ziarno)
    for _ in range(n):
        lo = rng.uniform(-180, 180)
        la = math.degrees(math.asin(rng.uniform(-1, 1)))
        c = kierunek_z_lonlat(lo, la)
        kat = np.arccos(np.clip(x * c[0] + y * c[1] + z * c[2], -1.0, 1.0))
        s = math.radians(rng.uniform(sigma_deg[0], sigma_deg[1]))
        znak = 1.0 if rng.random() < dodatnie else -1.0
        M.ksztalt += (znak * amp * rng.uniform(0.4, 1.0) * np.exp(-(kat / s) ** 2)).astype(np.float32)


def baza_proceduralna(M, PAL, ziarno, skala_plam=5.0, pasma=0.0, kontrast=1.0):
    """Tło albedo ciała bez map: prowincje (fbm, liniowo, bez progu — próg dawał plamy o miękkim brzegu jak chmury
    w atmosferze, a ciało jest bez powietrza), drobne cętki regolitu, opcjonalnie pasma (grzbiety szumu)."""
    W, H = M.W, M.H
    plamy = pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, skala_plam, 5, ziarno))
    drob = pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, skala_plam * 11.0, 4, ziarno + 7))
    t = np.clip(0.5 + (plamy - 0.5) * 2.4 * kontrast, 0.0, 1.0)
    kol = mix(np.ones((H, W, 1), np.float32) * PAL['ciemny'], np.ones((H, W, 1), np.float32) * PAL['jasny'], t)
    kol = kol * (0.82 + 0.36 * drob)[..., None]
    if pasma:
        ziarna = pole_szumu(W, H, lambda x, y, z: grzbiet3(x, y, z, skala_plam * 3.0, 4, ziarno + 11))
        kol = mix(kol, PAL['jasny'] * 1.15, smoothstep(0.55, 0.85, ziarna) * pasma)
    M.kol = kol.astype(np.float32)
    M.h = ((drob - 0.5) * 120.0).astype(np.float32)


# ── Infrastruktura ────────────────────────────────────────────────────────────
def zaklady(M, lon, lat, r, PAL, swiatla, ziarno, huta=None, zbiorniki=True, skala=1.0):
    """Zakład: hale w dwóch kierunkach (bez kraty), plac, opcjonalnie piece z żarem i żużlem, farma zbiorników.
    Nocą rzadkie światła hal (jedna barwa), żar pieców."""
    rows, cols, x, y = M.okno(lon, lat, r * 1.7)
    th = M.rng.uniform(0, math.pi)
    hm = np.zeros(x.shape, np.float32)
    for _ in range(int(M.rng.integers(9, 17))):
        bx, by = M.rng.normal(0, r * 0.42), M.rng.normal(0, r * 0.42)
        uu, vv = K.rot(x - bx, y - by, th + M.rng.choice([0.0, math.pi / 2]) + M.rng.normal(0, 0.04))
        hm = np.maximum(hm, K.pudelko(uu, vv, M.rng.uniform(1.6, 5.0) * skala, M.rng.uniform(1.0, 2.6) * skala, 0.3 * skala))
    plac = smoothstep(1.0, 0.6, np.sqrt(x * x + y * y) / r + 0.3 * (szum2(x, y, 1 / (r * 0.4), ziarno) - 0.5))
    M.mieszaj(rows, cols, PAL['plac'], plac * 0.22)
    M.mieszaj(rows, cols, PAL['hala'], hm * 0.85)
    M.wysokosc(rows, cols, hm * 260.0)
    M.kropki(lon, lat, x, y, hm, 10.0 / skala ** 2, (0.05, 0.28), 0.25 * skala, swiatla)
    if huta is not None:
        for _ in range(int(M.rng.integers(2, 4))):
            px, py = M.rng.normal(0, r * 0.3, 1), M.rng.normal(0, r * 0.3, 1)
            zuz = smoothstep(1.0, 0.3, np.sqrt((x - px[0]) ** 2 + (y - py[0]) ** 2) / (r * 0.28)
                             + 0.35 * szum2(x, y, 1 / (r * 0.1), ziarno + 5))
            M.mieszaj(rows, cols, PAL['zuzel'], zuz * 0.6)
            lo, la = M.lonlat(lon, lat, px, py)
            M.punkty(lo, la, 0.5, r * 0.035, huta)
            M.punkty(lo, la, 0.12, r * 0.12, huta)
    if zbiorniki:
        a = M.rng.uniform(0, 2 * math.pi)
        lo, la = M.lonlat(lon, lat, np.array([r * 1.25 * math.cos(a)]), np.array([r * 1.25 * math.sin(a)]))
        K.farma_zbiornikow(M, float(lo[0]), float(la[0]), r * 0.45, int(M.rng.integers(12, 26)), PAL['zbiornik'], swiatla,
                           ziarno + 3, skala=skala)


def stocznia(M, lon0, lat0, th_deg, PAL, n=4, skala=1.0):
    """Suche doki stoczni (wzór Luny w ksiezyce.py): różne długości i szerokości, przesunięcia, kadłuby w budowie;
    nocą przerywane krawędzie doków, spawy, bursztynowe znaki na końcach (barwa Unii Pasa)."""
    th = math.radians(th_deg)
    rows, cols, x, y = M.okno(lon0, lat0, 70.0 * skala)
    u0, v0 = K.rot(x, y, th)
    plac = smoothstep(1.0, 0.6, np.sqrt((u0 / (34 * skala)) ** 2 + ((v0 + 4 * skala) / (32 * skala)) ** 2)
                      + 0.45 * (szum2(x, y, 1 / (12.0 * skala), 3) - 0.5)) * (0.5 + 0.5 * szum2(x, y, 1 / (5.0 * skala), 5))
    dok_m = np.zeros(x.shape, np.float32)
    dno = np.zeros(x.shape, np.float32)
    kadl = np.zeros(x.shape, np.float32)
    off = -20.0 * skala
    for k in range(n):
        L = M.rng.uniform(18, 36) * skala
        Sz = M.rng.uniform(4.5, 7.0) * skala
        tk = th + math.radians(M.rng.uniform(-4.0, 4.0))
        sdv, sdu = off, M.rng.uniform(-8, 8) * skala
        off += Sz + M.rng.uniform(4.0, 8.0) * skala
        u, v = K.rot(x, y, tk)
        uu, vv = u - sdu, v - sdv
        dok_m = np.maximum(dok_m, K.pudelko(uu, vv, L + 2.4 * skala, Sz + 2.4 * skala, 0.8 * skala))
        dno = np.maximum(dno, K.pudelko(uu, vv, L, Sz, 0.6 * skala))
        if M.rng.random() < 0.8:
            fr = M.rng.uniform(0.45, 0.85)
            seg = 0.9 + 0.12 * smoothstep(0.3, 0.7, szum2(uu / 8.0, vv / 2.5, 1.0, k + 50))
            kadl = np.maximum(kadl, K.pudelko(uu - L * (0.5 - fr / 2) * M.rng.choice([-1, 1]), vv, L * fr,
                                              Sz * M.rng.uniform(0.45, 0.65), 0.35 * skala) * seg)
        nl = int(L / M.rng.uniform(2.4, 4.0))
        tt = np.sort(M.rng.uniform(-L / 2, L / 2, nl))
        for strona in (-1, 1):
            zost = M.rng.random(nl) > 0.5
            pu = tt[zost]
            pv = np.full(int(zost.sum()), strona * (Sz / 2 + 0.6 * skala)) + M.rng.normal(0, 0.2 * skala, int(zost.sum()))
            px, py = K.rot(pu + sdu, pv + sdv, -tk)
            lo, la = M.lonlat(lon0, lat0, px, py)
            M.punkty(lo, la, M.rng.uniform(0.06, 0.26, lo.size), 0.25 * skala, NOC['up_biel'])
        ns = int(M.rng.integers(1, 4))
        px, py = K.rot(M.rng.uniform(-L / 2.5, L / 2.5, ns) + sdu, M.rng.normal(0, Sz / 6, ns) + sdv, -tk)
        lo, la = M.lonlat(lon0, lat0, px, py)
        M.punkty(lo, la, M.rng.uniform(0.3, 0.6, ns), 0.3 * skala, NOC['spaw'])
        px, py = K.rot(np.array([L / 2 + 1.0 * skala]) * M.rng.choice([-1, 1]) + sdu, np.array([0.0]) + sdv, -tk)
        lo, la = M.lonlat(lon0, lat0, px, py)
        M.punkty(lo, la, 0.3, 0.25 * skala, NOC['up_bursz'])
    M.mieszaj(rows, cols, PAL['plac'], plac * 0.2)
    M.mieszaj(rows, cols, PAL['wal'], dok_m * 0.35)
    M.mieszaj(rows, cols, PAL['dok'], dno * 0.65)
    M.mieszaj(rows, cols, PAL['kadlub'], kadl * 0.8)
    M.wysokosc(rows, cols, dok_m * 120.0 - dno * 900.0 + kadl * 520.0)
    M.kropki(lon0, lat0, x, y, plac * (1 - dok_m), 0.6 / skala ** 2, (0.05, 0.2), 0.25 * skala, NOC['up_biel'])
    M.miejsca.append((lon0, lat0, 'stocznia'))


def wyrzutnia(M, lon, lat, th_deg, Lw, PAL, swiatla, koniec):
    """Tor wyrzutni masy: prosty, z rzadkimi światłami w nierównych odstępach i znakiem na końcu."""
    th = math.radians(th_deg)
    lo, la = M.lonlat(lon, lat, np.array([0.0, Lw * math.cos(th)]), np.array([0.0, Lw * math.sin(th)]))
    A, B = kierunek_z_lonlat(lo[0], la[0]), kierunek_z_lonlat(lo[1], la[1])
    maska = np.zeros((M.H, M.W), np.float32)
    linia(maska, A, B, M.W, M.H, M.R, waga=1.0)
    maska = np.clip(maska, 0, 1)
    M.kol = mix(M.kol, PAL['hala'] * 1.2, maska * 0.55)
    M.h += maska * 120.0
    n = max(6, int(Lw / 2.5))
    tt = np.sort(M.rng.uniform(0, Lw, n))
    tt = tt[M.rng.random(n) > 0.3]
    lo2, la2 = M.lonlat(lon, lat, tt * math.cos(th), tt * math.sin(th))
    M.punkty(lo2, la2, M.rng.uniform(0.04, 0.16, lo2.size), 0.25, swiatla)
    lo2, la2 = M.lonlat(lon, lat, np.array([Lw * math.cos(th)]), np.array([Lw * math.sin(th)]))
    M.punkty(lo2, la2, 0.3, 0.4, koniec)


def placowki(M, maska, n, odstep_deg, unikaj_km, PAL, swiatla, beacon, skala, ziarno0):
    """Rozproszone placówki: małe pole lądowisk, czasem kilka hal; nocą kilka świateł."""
    out = []
    for (lo, la) in K._losuj(M, maska, n * 3, odstep_deg):
        if len(out) >= n:
            break
        if not K.daleko_od(lo, la, [(a, b) for a, b, _ in M.miejsca], unikaj_km, M.R):
            continue
        K.ladowisko(M, lo, la, 4.0, int(M.rng.integers(1, 4)), PAL['plyta'], swiatla, None, ziarno0 + len(out), beacon, skala=skala)
        if M.rng.random() < 0.45:
            rows, cols, x, y = M.okno(lo, la, 6.0 * skala)
            th = M.rng.uniform(0, math.pi)
            hm = np.zeros(x.shape, np.float32)
            for _ in range(int(M.rng.integers(2, 5))):
                uu, vv = K.rot(x - M.rng.normal(0, 1.5 * skala), y - M.rng.normal(0, 1.5 * skala), th)
                hm = np.maximum(hm, K.pudelko(uu, vv, M.rng.uniform(0.8, 2.2) * skala, M.rng.uniform(0.6, 1.4) * skala, 0.2 * skala))
            M.mieszaj(rows, cols, PAL['hala'], hm * 0.8)
            M.wysokosc(rows, cols, hm * 150.0)
            M.kropki(lo, la, x, y, hm, 12.0 / skala ** 2, (0.05, 0.22), 0.2 * skala, swiatla)
        out.append((lo, la))
    for lo, la in out:
        M.miejsca.append((lo, la, 'placowka'))
    return out


# ── CERES: stolica Unii Pasa ──────────────────────────────────────────────────
OCCATOR = (-120.7, 19.8, 46.0)            # lon, lat, promień krateru [km] (Cerealia Facula w środku)
AHUNA = (-43.8, -10.5)


def stolica(M, PAL):
    """Miasto wokół krateru Occator — nie równy pierścień (wyglądał na doklejony), tylko dzielnice o różnych siatkach
    ulic: centrum na zachodnim wale (gęsto, drobne kwartały), dzielnice-płaty dookoła wału (więcej na zachodzie i
    południu), autostrady promieniście z osiedlami wzdłuż, obwodnica łukami z przerwami, kopuły (parki, habitaty),
    promenada na wale. Dno krateru z plamami soli (Cerealia, Vinalia) nietknięte. Nocą ciepłe okna, chłodna biel
    ulic, cyjan autostrad i kopuł (Unia Pasa), bursztyn znaków (barwa frakcji)."""
    lon0, lat0, rk = OCCATOR
    rows, cols, x, y = M.okno(lon0, lat0, 330.0)
    d = np.sqrt(x * x + y * y)
    poza = smoothstep(rk * 1.04, rk * 1.16, d)
    best = np.zeros(x.shape, np.float32)                 # zabudowa (najsilniejsza dzielnica w pikselu)
    ulice = np.zeros(x.shape, np.float32)
    los = np.zeros(x.shape, np.float32)                  # jasność kwartału
    # (środek x, y [km], półosie a, b, obrót [°], kwartał [km], gęstość); pierwsza — centrum
    dz = [(-rk * 1.6, 4.0, 32.0, 24.0, 12.0, 1.1, 1.0)]
    for k in range(13):
        a = M.rng.uniform(0.45 * math.pi, 1.6 * math.pi) if k < 7 else M.rng.uniform(-0.45 * math.pi, 0.45 * math.pi)
        rr = M.rng.uniform(rk * 1.55, 118.0)
        dz.append((rr * math.cos(a), rr * math.sin(a), M.rng.uniform(15, 32), M.rng.uniform(10, 21),
                   M.rng.uniform(0, 180), M.rng.uniform(1.4, 2.6), M.rng.uniform(0.55, 0.95)))
    for k, (cx, cy, a, b, th, blk, g) in enumerate(dz):
        uu, vv = K.rot(x - cx, y - cy, math.radians(th))
        e = np.sqrt((uu / a) ** 2 + (vv / b) ** 2) + 0.35 * (szum2(x, y, 1 / (a * 0.5), 30 + k) - 0.5)
        m = (smoothstep(1.0, 0.65, e) * g * poza).astype(np.float32)
        fu = (uu / blk) % 1.0
        fv = (vv / (blk * 1.35)) % 1.0
        s = np.maximum(smoothstep(0.1, 0.02, np.minimum(fu, 1 - fu)), smoothstep(0.08, 0.015, np.minimum(fv, 1 - fv)))
        h = (np.sin((np.floor(uu / blk) * 127.1 + np.floor(vv / (blk * 1.35)) * 311.7 + k * 7.3) * 12.9898) * 43758.5453) % 1.0
        sel = m > best
        best[sel] = m[sel]
        ulice[sel] = s[sel]
        los[sel] = h[sel]
    # autostrady promieniście od wału, osiedla wzdłuż (co ~35 km, coraz rzadsze)
    drogi_m = np.zeros(x.shape, np.float32)
    osiedla = np.zeros(x.shape, np.float32)
    konce = []
    for k, a in enumerate(np.linspace(0, 2 * math.pi, 7, endpoint=False) + M.rng.uniform(0, 0.8)):
        a += M.rng.normal(0, 0.12)
        L = M.rng.uniform(200, 300)
        ca, sa = math.cos(a), math.sin(a)
        p = x * ca + y * sa
        q = np.abs(-x * sa + y * ca)
        wzdl = smoothstep(rk * 1.05, rk * 1.2, p) * smoothstep(L, L - 8.0, p)
        drogi_m = np.maximum(drogi_m, smoothstep(0.55, 0.15, q) * wzdl)
        for t in np.arange(rk * 1.6 + M.rng.uniform(5, 25), L, M.rng.uniform(28, 42)):
            if M.rng.random() < 0.3:
                continue
            ox = t * ca + M.rng.normal(0, 3.0) * -sa
            oy = t * sa + M.rng.normal(0, 3.0) * ca
            rr = M.rng.uniform(3.0, 7.5) * (1.2 - 0.5 * t / L)
            dd = np.sqrt((x - ox) ** 2 + (y - oy) ** 2) / rr + 0.3 * (szum2(x, y, 1 / (rr * 0.6), 60 + k) - 0.5)
            osiedla = np.maximum(osiedla, smoothstep(1.0, 0.6, dd))
        konce.append((L * ca, L * sa))
    # obwodnica: łuki z przerwami między wałem a dzielnicami
    ro = rk * 1.24
    ang = np.arctan2(y, x)
    luki = smoothstep(0.45, 0.62, szum2(np.cos(ang) * 4.0, np.sin(ang) * 4.0, 1.0, 77))
    obw = smoothstep(0.6, 0.18, np.abs(d - ro)) * luki
    zab = np.clip(best + osiedla * 0.8, 0, 1)
    dach = PAL['dach'][None, None, :] * (0.6 + 0.8 * los)[..., None]
    M.mieszaj(rows, cols, dach, (zab * 0.85 * (1 - ulice)).astype(np.float32))
    M.mieszaj(rows, cols, PAL['ulica'], (best * ulice * 0.75).astype(np.float32))
    M.mieszaj(rows, cols, PAL['autostrada'], (np.maximum(drogi_m, obw) * 0.65).astype(np.float32))
    M.wysokosc(rows, cols, (zab * (1 - ulice) * (60.0 + 110.0 * los)).astype(np.float32))
    # kopuły (parki, habitaty) w dzielnicach
    kop = np.zeros(x.shape, np.float32)
    for k in range(16):
        cx, cy, a, b, th, blk, g = dz[k % len(dz)]
        px, py = cx + M.rng.normal(0, a * 0.4), cy + M.rng.normal(0, b * 0.4)
        if math.hypot(px, py) < rk * 1.2:
            continue
        rd = M.rng.uniform(1.4, 3.6)
        dd = np.sqrt((x - px) ** 2 + (y - py) ** 2) / rd
        kop = np.maximum(kop, smoothstep(1.05, 0.85, dd))
        lo, la = M.lonlat(lon0, lat0, np.array([px]), np.array([py]))
        M.punkty(lo, la, 0.2, rd * 0.55, NOC['up_ziel'] * 0.6 + NOC['okna'] * 0.4)
        kat = np.sort(M.rng.uniform(0, 2 * math.pi, int(M.rng.integers(5, 10))))
        lo, la = M.lonlat(lon0, lat0, px + np.cos(kat) * rd, py + np.sin(kat) * rd)
        M.punkty(lo, la, M.rng.uniform(0.08, 0.25, kat.size), 0.22, NOC['up_cyjan'])
    M.mieszaj(rows, cols, PAL['kopula'], kop * 0.75)
    M.wysokosc(rows, cols, kop * 260.0)
    # noc: okna (ciepłe), ulice (chłodne), centrum (gęsto), autostrady i obwodnica (cyjan, przerywane), osiedla
    M.kropki(lon0, lat0, x, y, best * (1 - ulice * 0.6), 420.0, (0.1, 0.55), 0.45, NOC['okna'])
    M.kropki(lon0, lat0, x, y, best * ulice, 220.0, (0.1, 0.5), 0.4, NOC['chlod'])
    centrum = smoothstep(1.0, 0.25, np.sqrt((x - dz[0][0]) ** 2 + (y - dz[0][1]) ** 2) / 20.0) * poza
    M.kropki(lon0, lat0, x, y, centrum, 650.0, (0.15, 0.7), 0.45, NOC['up_biel'])
    M.kropki(lon0, lat0, x, y, drogi_m, 140.0, (0.12, 0.55), 0.4, NOC['up_cyjan'])
    M.kropki(lon0, lat0, x, y, obw, 150.0, (0.12, 0.5), 0.4, NOC['chlod'])
    M.kropki(lon0, lat0, x, y, osiedla, 260.0, (0.1, 0.5), 0.45, NOC['okna'])
    # promenada na wale: łuki z przerwami; bursztynowe znaki na końcach autostrad
    for a0 in M.rng.uniform(0, 2 * math.pi, 4):
        kat = np.sort(M.rng.uniform(a0, a0 + M.rng.uniform(0.4, 1.0), int(M.rng.integers(8, 14))))
        lo, la = M.lonlat(lon0, lat0, np.cos(kat) * rk * 1.04, np.sin(kat) * rk * 1.04)
        M.punkty(lo, la, M.rng.uniform(0.06, 0.2, kat.size), 0.25, NOC['up_biel'])
    for ex, ey in konce:
        lo, la = M.lonlat(lon0, lat0, np.array([ex]), np.array([ey]))
        M.punkty(lo, la, 0.3, 0.35, NOC['up_bursz'])
        M.miejsca.append((float(lo[0]), float(la[0]), 'osada'))
    M.miejsca.append((lon0 + float(dz[0][0]) / (M.R * math.cos(math.radians(lat0))) * 180 / math.pi, lat0, 'stolica'))


def ceres(W, H):
    M = Cialo('ceres', W, H, 101)
    v, w = wczytaj_mozaike('ceres', W, H, True, lambda b, j0, H0: b > 0)
    v = K.wypelnij(v, w, 13, M.px_km)
    vs = K.rozciagnij(v, 1.0, 99.92)
    r_m = wczytaj_promien('ceres', W, H, True, 470000.0)
    M.log('mozaika Dawn + DTM')
    PAL = {k: kolor(v_) for k, v_ in dict(
        ciemny='#2e2d2b', sredni='#4a4845', jasny='#77797b', sol='#f4f2ec', swiezy='#7f8890',
        dach='#8f8d88', ulica='#2c2b29', autostrada='#6a6964', kopula='#a9b4b8', plyta='#9a9893', plac='#5b5a57', hala='#8a8984',
        wal='#5f5d59', dok='#2a2a2b', kadlub='#a1a4a8', zbiornik='#b7b5ae', zuzel='#3b2f29', droga='#3d3c3a',
        sciana='#7d878d', dno='#3f4a51', lod='#d6e0e6',
    ).items()}
    tlo = rozmyj_kula(vs, max(1.0, 40.0 / M.px_km))
    kol = mix(np.ones((H, W, 1), np.float32) * PAL['ciemny'], np.ones((H, W, 1), np.float32) * PAL['sredni'], smoothstep(0.12, 0.6, vs))
    kol = mix(kol, PAL['jasny'] * np.ones((H, W, 1), np.float32), smoothstep(0.62, 0.9, vs) * 0.8)
    kol = mix(kol, PAL['swiezy'] * np.ones((H, W, 1), np.float32), smoothstep(0.55, 0.85, tlo) * 0.25)   # błękit świeżych wyrzutów
    kol = kol * K.detal(vs, M.px_km, 30.0, 0.65, 1.45)[..., None] ** 0.55
    sol = smoothstep(0.95, 0.995, vs)                                         # plamy soli (Occator, Oxo, Haulani)
    M.kol = K.do_sredniej(kol, JASNOSC['ceres'], H, W)
    M.kol = mix(M.kol, PAL['sol'] * np.ones((H, W, 1), np.float32), sol * 0.9).astype(np.float32)
    M.h = (r_m - M.R * 1000.0).astype(np.float32)
    M.ksztalt = ksztalt_z_promienia(M, r_m)
    lat = szerokosci(H)
    rel = rozmyj_kula(np.abs(r_m - rozmyj_kula(r_m, max(1.0, 18.0 / M.px_km))), max(1.0, 6.0 / M.px_km))
    M.log('barwa, bryła')

    stolica(M, PAL)
    M.log('stolica (Occator)')
    lon0, lat0, _ = OCCATOR
    lo, la = M.lonlat(lon0, lat0, np.array([175.0]), np.array([-40.0]))
    K.ladowisko(M, float(lo[0]), float(la[0]), 26.0, 12, PAL['plyta'], NOC['up_biel'], NOC['up_cyjan'], 60, NOC['up_bursz'])
    M.miejsca.append((float(lo[0]), float(la[0]), 'port'))
    stocznia(M, -158.0, 4.0, 28.0, PAL, n=4, skala=1.0)
    M.log('port, stocznia')
    zaklady(M, -93.0, 33.0, 20.0, PAL, NOC['sod'], 70, huta=NOC['huta'])
    M.miejsca.append((-93.0, 33.0, 'huta'))
    zaklady(M, -139.0, -14.0, 16.0, PAL, NOC['chlod'], 80, huta=None)
    M.miejsca.append((-139.0, -14.0, 'elektronika'))
    M.log('zakłady')
    # kopalnie lodu w jasnych, zimnych kraterach przy biegunach
    with swiatla_odkrywki(sod='up_cyjan', biel='up_biel', huta='up_ziel'):
        for k, (lo_, la_) in enumerate([(62.0, 69.0), (-150.0, -67.0), (148.0, 72.0), (-12.0, -70.0)]):
            K.odkrywka(M, lo_, la_, M.rng.uniform(12, 18), dict(PAL, sciana=PAL['sciana'], dno=PAL['dno'], pyl=PAL['lod'],
                       halda=PAL['jasny'], zaklad=PAL['hala'], zuzel=PAL['jasny'], droga=PAL['droga']), PAL['lod'], 200 + k)
            M.miejsca.append((lo_, la_, 'lod'))
    M.log('kopalnie lodu')
    plaskie = (rel < np.percentile(rel, 50)) & (np.abs(lat) < 62) * np.ones((1, W), bool)
    placowki(M, plaskie, 26, 9.0, 110.0, PAL, NOC['up_biel'], NOC['up_bursz'], 0.9, 300)
    M.log('placówki')
    K.drogi(M, [(a, b) for a, b, _ in M.miejsca], PAL['droga'], NOC['up_biel'], maks_km=900.0, skroty=1, skrot_km=420.0,
            gestosc_swiatel=0.05, sila=0.3)
    M.log('drogi')
    return M


# ── WESTA: huta Unii Pasa ─────────────────────────────────────────────────────
def westa(W, H):
    M = Cialo('westa', W, H, 113)
    lat_r = lambda j0, n, H0: 90.0 - (np.arange(j0, j0 + n) + 0.5) / H0 * 180.0  # noqa: E731
    # biegun płn. był w nocy polarnej podczas HAMO — ciemne piksele powyżej 40° N to brak danych
    v, w = wczytaj_mozaike('westa', W, H, False,
                           lambda b, j0, H0: (b > 0) & ~((b < 16) & (lat_r(j0, b.shape[0], H0)[:, None] > 40.0)))
    v = K.wypelnij(v, w, 17, M.px_km)
    # powyżej ~50° N zdjęcia z niskim słońcem i wypełnione dziury (plamy, przepalone stoki) — jasność przechodzi
    # w gładkie tło z łagodnymi plamami; rzeźbę bieguna daje model wysokości (bryła i normalne)
    lat = szerokosci(H)
    t = (smoothstep(46.0, 60.0, lat) * np.ones((1, W), np.float32)).astype(np.float32)
    sr = float(np.median(v[(np.abs(lat) < 40.0) * np.ones((1, W), bool)]))
    plamy = pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, 6.0, 4, 31)) - 0.5
    v = (v + ((sr + plamy * 0.12) - v) * t).astype(np.float32)
    vs = K.rozciagnij(v, 1.0, 99.7)
    r_m = wczytaj_promien('westa', W, H, False, 0.0)
    M.log('mozaika Dawn + DTM')
    PAL = {k: kolor(v_) for k, v_ in dict(
        ciemny='#4f4a45', sredni='#8b867f', jasny='#cbc6bd', plyta='#c2bdb4', plac='#a59f96', hala='#5a5753',
        zbiornik='#c9c5bd', zuzel='#4b3a30', droga='#77716a', sciana='#7b736a', dno='#3a3632', fe='#8a5a40',
        ti='#646a72', halda='#9b948a', pyl='#8e877e', zaklad='#4a4744', swiezy='#d8d4cc',
    ).items()}
    tlo = rozmyj_kula(vs, max(1.0, 30.0 / M.px_km))
    kol = mix(np.ones((H, W, 1), np.float32) * PAL['ciemny'], np.ones((H, W, 1), np.float32) * PAL['sredni'], smoothstep(0.1, 0.5, tlo))
    kol = mix(kol, PAL['jasny'] * np.ones((H, W, 1), np.float32), smoothstep(0.55, 0.85, vs) * 0.7)
    kol = kol * K.detal(vs, M.px_km, 20.0, 0.6, 1.5)[..., None] ** 0.6
    M.kol = K.do_sredniej(kol, JASNOSC['westa'], H, W)
    M.h = (r_m - M.R * 1000.0).astype(np.float32)
    M.ksztalt = ksztalt_z_promienia(M, r_m)
    M.log('barwa, bryła')
    # huta w rowach Divalia Fossae (równik), odkrywki żelaza i tytanu, port i tor wyrzutni masy
    zaklady(M, 22.0, -6.0, 15.0, PAL, NOC['sod'], 40, huta=NOC['huta'], skala=0.8)
    zaklady(M, 31.0, -1.0, 9.0, PAL, NOC['sod'], 41, huta=NOC['huta'], zbiorniki=False, skala=0.8)
    M.miejsca.append((22.0, -6.0, 'huta'))
    with swiatla_odkrywki(sod='sod', biel='biel', huta='huta'):
        for k, (lo_, la_, ruda) in enumerate([(66.0, 14.0, 'fe'), (-38.0, -22.0, 'ti'), (148.0, -12.0, 'fe'), (-118.0, 18.0, 'ti')]):
            K.odkrywka(M, lo_, la_, M.rng.uniform(10, 15), PAL, PAL[ruda], 50 + k)
            M.miejsca.append((lo_, la_, 'kopalnia'))
    lo, la = M.lonlat(22.0, -6.0, np.array([-34.0]), np.array([20.0]))
    K.ladowisko(M, float(lo[0]), float(la[0]), 12.0, 6, PAL['plyta'], NOC['biel'], NOC['up_cyjan'], 60, NOC['up_bursz'], skala=0.8)
    M.miejsca.append((float(lo[0]), float(la[0]), 'port'))
    wyrzutnia(M, 22.0, -6.0, 8.0, 70.0, PAL, NOC['biel'], NOC['up_cyjan'])
    M.log('huta, odkrywki, port, wyrzutnia')
    rel = rozmyj_kula(np.abs(r_m - rozmyj_kula(r_m, max(1.0, 14.0 / M.px_km))), max(1.0, 5.0 / M.px_km))
    lat = szerokosci(H)
    plaskie = (rel < np.percentile(rel, 45)) & (np.abs(lat) < 60) * np.ones((1, W), bool)
    placowki(M, plaskie, 8, 14.0, 90.0, PAL, NOC['sod'], NOC['up_cyjan'], 0.7, 90)
    K.drogi(M, [(a, b) for a, b, _ in M.miejsca], PAL['droga'], NOC['sod'], maks_km=600.0, skroty=1, skrot_km=300.0,
            gestosc_swiatel=0.05, sila=0.3)
    M.log('placówki, drogi')
    return M


# ── PALLAS, HYGIEA, PSYCHE: proceduralnie ──────────────────────────────────────
def pallas(W, H):
    """Pallas (typ B): „piłka golfowa” (VLT SPHERE, Marsset i in. 2020, Nature Astronomy 4: 569): ~36 kraterów
    > 30 km na ≥ 10% powierzchni, dwa wielkie baseny — ~400 km wzdłuż równika (może po zderzeniu, które dało
    rodzinę Pallas), jasna plama na półkuli płd. (sól po przeobrażeniu wodnym?). Orbita nachylona o 35° — zderzenia
    ~11,5 km/s, 2–3× częstsze niż na Ceres i Weście. Osie 569 × 525 × 500 km + garby; barwa szaroniebieskawa (typ B).
    Położenia basenów i plamy — umowne (VLT nie podaje ich w danych, z których korzystamy)."""
    M = Cialo('pallas', W, H, 127)
    PAL = {k: kolor(v_) for k, v_ in dict(
        ciemny='#5a6168', jasny='#747e88', swiezy='#a4aeb8', dno='#40464d', plyta='#a4adb4', hala='#565d64',
        zbiornik='#b4bcc2', sciana='#6f7882', pyl='#87919a', halda='#7a848d', zaklad='#4b5157', zuzel='#59626a',
        droga='#5d666e', ruda='#9aa5ae', sol='#d3dade',
    ).items()}
    baza_proceduralna(M, PAL, 21, skala_plam=4.5, kontrast=0.45)
    M.ksztalt = ksztalt_elipsoidy(OSIE_KM['pallas'], M.R, 0.02, 5)
    garby(M, 12, 0.03, (14.0, 38.0), 51)
    basen(M, -62.0, 4.0, 200.0, 12000.0, 7, wal=0.1, gorka=0.25)          # ~400 km wzdłuż równika
    basen(M, 112.0, -32.0, 85.0, 7000.0, 8)
    M.miejsca += [(-62.0, 4.0, 'basen równikowy'), (112.0, -32.0, 'basen')]
    # populacja prawie nasycona: N(> r) ∝ r^−1,6 → ~37 kraterów o r > 15 km (jak „~36 > 30 km” z VLT)
    for k, (lo, la, r, wiek) in enumerate(kratery_losowe(M.rng, 1700, 1.5, 55.0, 1.6)):
        krater(M, lo, la, r, wiek, PAL, 400 + k)
    # jasna plama: krater z jasnymi osadami na dnie (jak Cerealia i Vinalia Faculae w Occatorze na Ceres — jasna
    # centralna plama i rozproszone mniejsze) i słabą, rwaną aureolą wokół; bez promieni (wyglądała jak flara)
    krater(M, 18.0, -46.0, 22.0, 0.3, PAL, 950)
    rows, cols, x, y = okno_kuli(18.0, -46.0, 70.0, W, H, M.R)
    d = np.sqrt(x * x + y * y) / 22.0
    # szum wartości progowany daje prostokątne plamy (interpolacja osiami kraty) — średnia z obróconych układów
    xr, yr = x * 0.8 - y * 0.6, x * 0.6 + y * 0.8
    xq, yq = x * 0.28 + y * 0.96, -x * 0.96 + y * 0.28
    n1 = (0.4 * szum2(x, y, 1 / 6.0, 23) + 0.35 * szum2(xr, yr, 1 / 4.5, 24) + 0.25 * szum2(xq, yq, 1 / 2.6, 25))
    n2 = 0.5 * (szum2(x, y, 1 / 12.0, 29) + szum2(xr, yr, 1 / 9.0, 30))
    rdzen = smoothstep(0.45, 0.08, d + 0.5 * (n1 - 0.5)) * 0.85
    rozsiane = smoothstep(0.85, 0.4, d) * smoothstep(0.53, 0.66, n1) * 0.5
    aureola = smoothstep(2.6, 0.9, d + 1.2 * (n2 - 0.5)) * (0.3 + 0.7 * smoothstep(0.4, 0.6, n1)) * 0.16
    M.mieszaj(rows, cols, PAL['sol'], np.clip(rdzen + rozsiane + aureola, 0, 1).astype(np.float32))
    M.miejsca += [(18.0, -46.0, 'jasna plama')]
    M.kol = K.do_sredniej(M.kol, JASNOSC['pallas'], H, W)
    M.log('bryła, kratery')
    with swiatla_odkrywki(sod='up_cyjan', biel='up_biel', huta='up_ziel'):
        for k, (lo_, la_) in enumerate([(24.0, 18.0), (-128.0, -9.0), (118.0, 31.0)]):
            K.odkrywka(M, lo_, la_, M.rng.uniform(7, 10), PAL, PAL['ruda'], 70 + k)
            M.miejsca.append((lo_, la_, 'kopalnia'))
            lo2, la2 = M.lonlat(lo_, la_, np.array([22.0]), np.array([-9.0]))
            K.ladowisko(M, float(lo2[0]), float(la2[0]), 6.0, 3, PAL['plyta'], NOC['up_biel'], NOC['up_cyjan'], 80 + k, NOC['up_bursz'], skala=0.7)
    lat = szerokosci(H)
    placowki(M, (np.abs(lat) < 60) * np.ones((1, W), bool), 5, 18.0, 80.0, PAL, NOC['up_biel'], NOC['up_bursz'], 0.6, 120)
    K.drogi(M, [(a, b) for a, b, c in M.miejsca if c in ('kopalnia', 'placowka')], PAL['droga'], NOC['up_biel'],
            maks_km=420.0, skroty=0, gestosc_swiatel=0.04, sila=0.25)
    M.log('placówki Unii')
    return M


def hygiea(W, H):
    M = Cialo('hygiea', W, H, 131)
    PAL = {k: kolor(v_) for k, v_ in dict(
        ciemny='#2d2c2a', jasny='#46443f', swiezy='#6d6b66', dno='#262523', plyta='#8f8c85', hala='#4c4a46',
        zbiornik='#a8a59d', droga='#3a3936', lod='#c8d2d8',
    ).items()}
    baza_proceduralna(M, PAL, 33, skala_plam=3.2, kontrast=0.3)
    # prawie kulista (VLT SPHERE, Vernazza i in. 2019, Nature Astronomy 4: 136): brak wielkiego basenu mimo rodziny —
    # bryła złożyła się na nowo po rozbiciu; łagodne garby, kratery zatarte, rozpoznane tylko dwa: Romulus (21 km)
    # i Remus (11 km). Ich położenia — umowne.
    M.ksztalt = ksztalt_elipsoidy(OSIE_KM['hygiea'], M.R, 0.006, 9)
    garby(M, 8, 0.008, (20.0, 50.0), 61)
    for k, (lo, la, r, wiek) in enumerate(kratery_losowe(M.rng, 700, 1.2, 30.0, 1.9)):
        krater(M, lo, la, r, min(1.0, wiek * 0.6 + 0.35), PAL, 500 + k, glab_k=0.8)      # gładka, kratery zatarte
    krater(M, -14.0, 27.0, 10.5, 0.18, PAL, 901)          # Romulus
    krater(M, 38.0, -9.0, 5.5, 0.12, PAL, 902)            # Remus
    M.miejsca += [(-14.0, 27.0, 'Romulus'), (38.0, -9.0, 'Remus')]
    M.kol = K.do_sredniej(M.kol, JASNOSC['hygiea'], H, W)
    M.log('bryła, kratery')
    for k, (lo_, la_) in enumerate([(102.0, 38.0), (-71.0, -24.0), (-160.0, 12.0)]):
        K.ladowisko(M, lo_, la_, 7.0, 3, PAL['plyta'], NOC['up_biel'], NOC['up_ziel'], 90 + k, NOC['up_bursz'], skala=0.7)
        K.farma_zbiornikow(M, lo_ + 2.5, la_ - 1.5, 3.5, int(M.rng.integers(8, 16)), PAL['zbiornik'], NOC['up_cyjan'], 95 + k, skala=0.7)
        M.miejsca.append((lo_, la_, 'posterunek'))
    K.drogi(M, [(a, b) for a, b, c in M.miejsca if c == 'posterunek'], PAL['droga'], NOC['up_biel'], maks_km=300.0, skroty=0,
            gestosc_swiatel=0.03, sila=0.2)
    M.log('posterunki Unii')
    return M


def psyche(W, H):
    M = Cialo('psyche', W, H, 137)
    PAL = {k: kolor(v_) for k, v_ in dict(
        ciemny='#57524c', jasny='#8d877e', swiezy='#bdb6aa', dno='#45413c', plyta='#a9a49b', hala='#4f4b46',
        zbiornik='#b9b3a9', sciana='#8a857d', pyl='#7d776f', halda='#8f897f', zaklad='#47433f', zuzel='#5d4d40',
        droga='#625c55', metal='#c9c3b8', krzemian='#403c37',
    ).items()}
    baza_proceduralna(M, PAL, 45, skala_plam=2.6, kontrast=0.35)
    # albedo: łagodne prowincje metalu (jaśniej) i krzemianu (piroksen w widmie — ciemniej), liniowo, nie progiem
    # (próg dawał białe „chmury”); rzeźbę daje mapa normalnych, świeże kratery odsłaniają metal (ton `swiezy`)
    metal = pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, 3.4, 4, 47))
    one = np.ones((H, W, 1), np.float32)
    M.kol = mix(M.kol, one * PAL['metal'], np.clip((metal - 0.5) * 1.6, 0.0, 1.0) * 0.22)
    M.kol = mix(M.kol, one * PAL['krzemian'], np.clip((0.5 - metal) * 1.6, 0.0, 1.0) * 0.2).astype(np.float32)
    # bryła: 278 × 238 × 171 km, bliska elipsoidzie Jacobiego (Ferrais i in. 2020, A&A 638, L15) z dwoma wielkimi
    # zagłębieniami ~90 km z VLT SPHERE — Meroe i Panthia (bliźniacze czarownice z „Metamorfoz” Apulejusza; Panthia
    # ~10 km głębi, jaśniejsza od otoczenia; Meroe — ciemniejsza, jej istnienie mniej pewne; Shepard i in. 2021).
    # Położenia — umowne.
    M.ksztalt = ksztalt_elipsoidy(OSIE_KM['psyche'], M.R, 0.03, 13)
    garby(M, 10, 0.03, (14.0, 35.0), 71, dodatnie=0.45)
    basen(M, -38.0, 12.0, 44.0, 7500.0, 15, barwa=PAL['krzemian'], sila=0.25)                 # Meroe
    basen(M, 128.0, -22.0, 45.0, 10000.0, 16, gorka=0.12, barwa=PAL['metal'], sila=0.2)       # Panthia
    M.miejsca += [(-38.0, 12.0, 'Meroe'), (128.0, -22.0, 'Panthia')]
    for k, (lo, la, r, wiek) in enumerate(kratery_losowe(M.rng, 900, 0.6, 28.0, 1.7)):
        krater(M, lo, la, r, wiek, PAL, 600 + k)
    M.kol = K.do_sredniej(M.kol, JASNOSC['psyche'], H, W)
    M.log('bryła, kratery')
    with swiatla_odkrywki(sod='sod', biel='up_biel', huta='huta'):
        for k, (lo_, la_) in enumerate([(-60.0, 34.0), (60.0, -8.0), (166.0, 20.0)]):
            K.odkrywka(M, lo_, la_, M.rng.uniform(5.5, 8.0), PAL, PAL['metal'], 110 + k)
            M.miejsca.append((lo_, la_, 'kopalnia'))
    lo, la = M.lonlat(60.0, -8.0, np.array([16.0]), np.array([10.0]))
    K.ladowisko(M, float(lo[0]), float(la[0]), 5.0, 4, PAL['plyta'], NOC['up_biel'], NOC['up_cyjan'], 130, NOC['up_bursz'], skala=0.5)
    M.miejsca.append((float(lo[0]), float(la[0]), 'port'))
    K.drogi(M, [(a, b) for a, b, c in M.miejsca if c in ('kopalnia', 'port')], PAL['droga'], NOC['sod'], maks_km=260.0,
            skroty=0, gestosc_swiatel=0.05, sila=0.25)
    M.log('odkrywki metalu Unii')
    return M


# ── PLUTON, CHARON: New Horizons ──────────────────────────────────────────────
def kolano(kol, prog=0.62):
    """Miękkie nasycenie jasnych miejsc (liniowo): powyżej progu kompresja — bez przepalonych plam (serce Plutona)."""
    L = luminancja(kol)
    Lk = np.where(L > prog, prog + (L - prog) / (1.0 + (L - prog) / (1.0 - prog)), L)
    return (kol * (Lk / np.maximum(L, 1e-6))[..., None]).astype(np.float32)


def wypelnij_gladko(v, w, ziarno, px_km):
    """Jak ksiezyce.wypelnij, ale półkula nieoglądana (noc polarna podczas przelotu New Horizons) gładka z łagodnymi
    plamami — szum detalu na ~⅓ mapy wyglądał jak piasek w pasach."""
    out = K.wypelnij(v, w, ziarno, px_km)
    t = smoothstep(0.75, 0.15, rozmyj_kula(w, 3.0))
    H, W = v.shape
    plamy = pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, 3.0, 4, ziarno + 5)) - 0.5
    gl = rozmyj_kula(out, max(1.0, 14.0 / px_km)) + plamy * float(np.std(v[w > 0.5])) * 0.8
    return np.clip(out * (1 - t) + gl * t, 0, 1).astype(np.float32)


def pluton(W, H):
    M = Cialo('pluton', W, H, 149)
    v, w = wczytaj_mozaike('pluton', W, H, True, lambda b, j0, H0: b > 0)
    v = wypelnij_gladko(v, w, 19, M.px_km)
    vs = K.rozciagnij(v, 0.5, 99.6)
    lon, lat = dlugosci(W), szerokosci(H)
    M.log('mozaika New Horizons')
    PAL = {k: kolor(v_) for k, v_ in dict(
        cthulhu='#3e2118', rdza='#8a5236', tan='#c39a74', krem='#ecdcc6', azot='#e9edf0', szron='#d9cbbb',
    ).items()}
    tlo = rozmyj_kula(vs, max(1.0, 30.0 / M.px_km))
    one = np.ones((H, W, 1), np.float32)
    kol = mix(one * PAL['cthulhu'], one * PAL['rdza'], smoothstep(0.08, 0.32, vs))
    kol = mix(kol, one * PAL['tan'], smoothstep(0.3, 0.55, vs))
    kol = mix(kol, one * PAL['krem'], smoothstep(0.58, 0.85, vs))
    serce = smoothstep(32.0, 18.0, odleglosc_kat(lon, lat, 177.0, 22.0)) * smoothstep(0.55, 0.8, tlo)
    kol = mix(kol, one * PAL['azot'], serce * 0.8)                              # Sputnik Planitia — lód azotowy
    kol = mix(kol, one * PAL['szron'], smoothstep(55.0, 75.0, lat) * 0.4 * one[..., 0])  # Lowell Regio
    kol = kol * K.detal(vs, M.px_km, 40.0, 0.7, 1.35)[..., None] ** 0.5
    M.kol = kolano(K.do_sredniej(kol, JASNOSC['pluton'], H, W))
    M.h = ((vs - rozmyj_kula(vs, max(1.0, 25.0 / M.px_km))) * 1600.0 * (1 - serce * 0.7)).astype(np.float32)
    M.miejsca += [(177.0, 22.0, 'Sputnik Planitia'), (-140.0, -5.0, 'Cthulhu')]
    return M


def charon(W, H):
    M = Cialo('charon', W, H, 151)
    v, w = wczytaj_mozaike('charon', W, H, False, lambda b, j0, H0: b > 0)
    v = wypelnij_gladko(v, w, 23, M.px_km)
    vs = K.rozciagnij(v, 0.5, 99.6)
    lat = szerokosci(H)
    M.log('mozaika New Horizons')
    PAL = {k: kolor(v_) for k, v_ in dict(ciemny='#4b4946', szary='#8e8a85', jasny='#c4c0ba', mordor='#5b2f22').items()}
    one = np.ones((H, W, 1), np.float32)
    kol = mix(one * PAL['ciemny'], one * PAL['szary'], smoothstep(0.15, 0.55, vs))
    kol = mix(kol, one * PAL['jasny'], smoothstep(0.62, 0.9, vs))
    mordor = smoothstep(58.0, 72.0, lat) * smoothstep(0.55, 0.2, vs)
    kol = mix(kol, one * PAL['mordor'], (mordor * 0.85) * one[..., 0])
    kol = kol * K.detal(vs, M.px_km, 25.0, 0.7, 1.35)[..., None] ** 0.5
    M.kol = kolano(K.do_sredniej(kol, JASNOSC['charon'], H, W))
    M.h = ((vs - rozmyj_kula(vs, max(1.0, 20.0 / M.px_km))) * 1800.0).astype(np.float32)
    M.miejsca += [(0.0, 80.0, 'Mordor Macula')]
    return M


GENERATORY = dict(ceres=ceres, westa=westa, pallas=pallas, hygiea=hygiea, psyche=psyche, pluton=pluton, charon=charon)


# ── Zapis ──────────────────────────────────────────────────────────────────────
def zapisz_ksztalt(sciezka, d, zakres):
    lo, hi = zakres
    poza = float(((d < lo) | (d > hi)).mean())
    q = np.clip(np.round((d - lo) / (hi - lo) * 65535.0), 0, 65535).astype(np.uint32)
    rgb = np.stack([(q >> 8).astype(np.uint8), (q & 255).astype(np.uint8), np.zeros(q.shape, np.uint8)], -1)
    os.makedirs(os.path.dirname(sciezka), exist_ok=True)
    Image.fromarray(rgb, 'RGB').save(sciezka, optimize=True)
    return poza


def zapisz(M, wyj, podglady):
    prefix = PLIK[M.cialo]
    kol_srgb = lin_do_srgb(M.kol)
    L = luminancja(M.noc)
    Lk = np.where(L > 0.35, 0.35 + (L - 0.35) / (1.0 + (L - 0.35) / 0.3), L)          # sufit ~0,65 (jak księżyce)
    noc = M.noc * (Lk / np.maximum(L, 1e-6))[..., None]
    noc_srgb = lin_do_srgb(np.clip(noc, 0, 1))
    h = M.h - rozmyj_kula(M.h, M.sigma_bryly_px()) if M.gorne else M.h      # duże formy są w bryle (Cialo.gorne)
    nrm = normalne_z_wysokosci(h, M.R * 1000.0, PRZEWYZSZENIE[M.cialo])
    zapisz_rgb(os.path.join(wyj, f'{prefix}_hf_color.jpg'), kol_srgb, 92)
    zapisz_rgb(os.path.join(wyj, f'{prefix}_hf_night.jpg'), noc_srgb, 92)
    zapisz_normalne(os.path.join(wyj, f'{prefix}_hf_normal.jpg'), nrm, 95)
    info = ''
    if M.ksztalt is not None:
        zakres = ZAKRES_KSZTALTU[prefix]
        poza = zapisz_ksztalt(os.path.join(wyj, f'{prefix}_hf_shape.png'), M.ksztalt, zakres)
        info = f'  kształt d ∈ [{float(M.ksztalt.min()):.4f}, {float(M.ksztalt.max()):.4f}] (zakres {zakres}, poza: {100 * poza:.2f}%)'
        if poza > 0:
            print(f'UWAGA: {M.cialo} — kształt poza zakresem SMALL_BODY_SHAPE (planetMaps.js)', flush=True)
        podglad(os.path.join(podglady, f'{M.cialo}-ksztalt.png'),
                np.clip((M.ksztalt - zakres[0]) / (zakres[1] - zakres[0]), 0, 1))
    razem = np.clip(kol_srgb * 0.45 + noc_srgb * 1.2, 0, 1)
    for nazwa, a in (('kolor', kol_srgb), ('noc', noc_srgb), ('normalne', nrm * 0.5 + 0.5), ('razem', razem)):
        podglad(os.path.join(podglady, f'{M.cialo}-{nazwa}.png'), a)
    with open(os.path.join(podglady, f'{M.cialo}-miejsca.json'), 'w', encoding='utf-8') as f:
        json.dump([[round(a, 2), round(b, 2), c] for a, b, c in M.miejsca], f, ensure_ascii=False)
    sr = float(np.average(luminancja(M.kol), weights=np.cos(np.radians(szerokosci(M.H))) * np.ones((1, M.W))))
    M.log(f'zapis → {wyj}  jasność {sr:.3f}{info}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cialo', default='wszystkie', help=' | '.join(CIALA) + ' | wszystkie (po przecinku kilka)')
    ap.add_argument('--szer', type=int, default=None, help='szerokość mapy (domyślnie: podgląd 2048, gra wg GRA_SZER)')
    ap.add_argument('--do-gry', action='store_true', help='zapis do public/assets/planety/solar/small/')
    a = ap.parse_args()
    ciala = CIALA if a.cialo == 'wszystkie' else tuple(a.cialo.split(','))
    for c in ciala:
        W = a.szer or (GRA_SZER[c] if a.do_gry else 2048)
        H = W // 2
        wyj = os.path.join(KATALOG_REPO, 'public', 'assets', 'planety', 'solar', 'small') if a.do_gry \
            else os.path.join(KATALOG_REPO, '.tmp', 'planety', f'male-{W}')
        M = GENERATORY[c](W, H)
        zapisz(M, wyj, os.path.join(KATALOG_REPO, '.tmp', 'planety', f'podglad-male-{W}'))


if __name__ == '__main__':
    main()
