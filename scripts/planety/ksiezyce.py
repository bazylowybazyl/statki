# -*- coding: utf-8 -*-
"""Generator map księżyców (HULLFALL): Luna, Io, Europa, Ganimedes, Kallisto — każdy z rolą w ekonomii gry
(src/data/systemMap.js, resources.js, factions.js):

  luna       węzeł wojskowo-przemysłowy Terra Nova BEZ wydobycia: aneks stoczni (suche doki), depoty (farmy
             zbiorników), garnizony (bunkry), lądowiska; nocą chłodne białe światła baz i lądowisk
  io         jedyna kopalnia metalu przy Jowiszu (Fe, Ti, Cu), Konsorcjum Zewnętrzne: kilka odkrywek wśród pól
             siarki i wulkanów, zakłady, hałdy; nocą sód i żar hut, słaby żar czynnych paterae
  europa     kopalnia lodu Unii Pasa: cięcia w lodzie wzdłuż spękań (lineae), platformy; nocą chłodna zieleń
  ganimedes  węzeł Konsorcjum: depot i lądowiska, mało
  kallisto   węzeł Konsorcjum: depot w basenie Valhalla i lądowiska, mało

Wejście (domena publiczna, pobierane raz do .tmp/planety-dane/<ciało>/):
  luna/lroc_color_poles_8k.tif, luna/ldem_16.tif           NASA SVS CGI Moon Kit (LRO LROC WAC, LOLA)
  io|europa|ganimedes|kallisto/*_global_mosaic_*.tif        USGS Astrogeology, mozaiki Voyager + Galileo SSI
Barwa Io z dotychczasowej mapy gry (jupiterIo.jpg — chroma), reszta galileuszowych barwiona paletą z jasności.
Wyjście: public/assets/planety/solar/moons/<plik>_hf_{color,night,normal}.jpg (równoodległe, kolumna 0 = 180° W).

  .tmp/venv-planety/Scripts/python -I scripts/planety/ksiezyce.py --cialo io               # podgląd 2048
  .tmp/venv-planety/Scripts/python -I scripts/planety/ksiezyce.py --cialo wszystkie --do-gry
"""
import argparse
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from scipy import ndimage as ndi  # noqa: E402
from wspolne import *  # noqa: E402,F401,F403
from infrastruktura import okno, linia, siec, szum2  # noqa: E402

CIALA = ('luna', 'io', 'europa', 'ganimedes', 'kallisto')
R_KM = dict(luna=1737.4, io=1821.6, europa=1560.8, ganimedes=2634.1, kallisto=2410.3)
# Rozdzielczość gry: gęstość tekseli w jednostkach świata ≥ Ziemi 8K (Luna 9 072 j. → 4096; galileuszowe
# 2 000–2 900 j. → 2048 daje 6–9 j. na teksel, dwa razy gęściej niż Ziemia)
GRA_SZER = dict(luna=4096, io=2048, europa=2048, ganimedes=2048, kallisto=2048)
PLIK = dict(luna='luna', io='io', europa='europa', ganimedes='ganymede', kallisto='callisto')
ZRODLO = dict(
    io='io/Io_GalileoSSI-Voyager_Global_Mosaic_1km.tif',
    europa='europa/Europa_Voyager_GalileoSSI_global_mosaic_500m.tif',
    ganimedes='ganimedes/Ganymede_Voyager_GalileoSSI_global_mosaic_1km.tif',
    kallisto='kallisto/Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif',
)
# Rzeźba w mapie normalnych (przewyższenie wysokości) — Luna z LOLA, reszta z jasności + infrastruktura
PRZEWYZSZENIE = dict(luna=2.2, io=2.0, europa=2.0, ganimedes=2.0, kallisto=2.0)

# Barwy świateł frakcji (sRGB): Terra Nova chłodna biel, Konsorcjum Zewnętrzne sód i żar hut (fiolet tylko
# w znakach nawigacyjnych portów — barwa frakcji), Unia Pasa chłodna zieleń
NOC = {k: kolor(v) for k, v in dict(
    tn_biel='#e6eeff', tn_niebo='#b9d4ff', tn_cieplo='#ffe2b8', czerwien='#ff3b2f', spaw='#cfe2ff',
    sod='#ffb35a', huta='#ff6a2a', biel='#fff1d8', fiolet='#c4a8ff', lawa='#ff4a1e',
    up_ziel='#86ffd2', up_cyjan='#9ff0ff', up_biel='#d8fff4',
).items()}


# ── Wczytanie danych ───────────────────────────────────────────────────────────
def wczytaj_szara(cialo, W, H):
    """Mozaika USGS (uint8, 0 = brak danych) → jasność [0, 1] i waga ważności (H, W)."""
    cache = os.path.join(KATALOG_DANYCH, cialo, f'mozaika_{W}.npz')
    if os.path.exists(cache):
        z = np.load(cache)
        return z['v'], z['w']
    import tifffile
    with tifffile.TiffFile(os.path.join(KATALOG_DANYCH, ZRODLO[cialo])) as tf:
        a = tf.pages[0].asarray()
    m = (a > 0).astype(np.uint8) * 255
    k = max(1, a.shape[1] // (2 * W))
    im, mi = Image.fromarray(a), Image.fromarray(m)
    del a, m
    if k > 1:
        im, mi = im.reduce(k), mi.reduce(k)            # średnia z pudełka: wartość × udział danych
    v = np.asarray(im, np.float32) / 255.0
    w = np.asarray(mi, np.float32) / 255.0
    v = przeskaluj(v, W, H)
    w = np.clip(przeskaluj(w, W, H), 0, 1)
    v = np.clip(v / np.maximum(w, 1e-3), 0, 1)
    np.savez(cache, v=v.astype(np.float32), w=w.astype(np.float32))
    return v, w


def wczytaj_lune(W, H):
    """LROC WAC (barwa, liniowo) i LOLA (wysokość, m) dla Luny."""
    cache = os.path.join(KATALOG_DANYCH, 'luna', f'luna_{W}.npz')
    if os.path.exists(cache):
        z = np.load(cache)
        return z['kol'], z['h']
    import tifffile
    with tifffile.TiffFile(os.path.join(KATALOG_DANYCH, 'luna', 'lroc_color_poles_8k.tif')) as tf:
        a = tf.pages[0].asarray()
    kol = srgb_do_lin(np.asarray(Image.fromarray(a, 'RGB').resize((W, H), Image.LANCZOS), np.float32) / 255.0)
    with tifffile.TiffFile(os.path.join(KATALOG_DANYCH, 'luna', 'ldem_16.tif')) as tf:
        h = tf.pages[0].asarray().astype(np.float32) * 1000.0          # km → m (względem 1 737,4 km)
    h = przeskaluj(h, W, H)
    np.savez(cache, kol=kol, h=h)
    return kol, h


def wypelnij(v, w, ziarno, px_km):
    """Brak danych (bieguny, luki mozaik): wypełnienie od brzegów coraz szerszym rozmyciem + szum
    o amplitudzie detalu z ważnych pikseli (bez szumu wypełnienie byłoby gładką plamą)."""
    jest = w > 0.5
    if jest.all():
        return v
    out = v.copy()
    zrobione = jest.copy()
    vw = np.where(jest, v, 0).astype(np.float32)
    jw = jest.astype(np.float32)
    for s in (2, 4, 8, 16, 32, 64, 128, 256):
        num = rozmyj_kula(vw, s)
        den = rozmyj_kula(jw, s)
        bierz = (~zrobione) & (den > 0.03)
        out[bierz] = (num / np.maximum(den, 1e-6))[bierz]
        zrobione |= bierz
    out[~zrobione] = float(v[jest].mean())
    detal = v - rozmyj_kula(v, max(1.0, 25.0 / px_km))
    amp = float(np.std(detal[jest]))
    H, W = v.shape
    sz = pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, 80.0, 5, ziarno)) - 0.5
    plamy = pole_szumu(W, H, lambda x, y, z: grzbiet3(x, y, z, 24.0, 4, ziarno + 1)) - 0.45
    t = smoothstep(0.75, 0.15, rozmyj_kula(jw, 3.0))
    return np.clip(out + (sz * 2.6 + plamy * 0.8) * amp * t, 0, 1)


# ── Stan jednego ciała ─────────────────────────────────────────────────────────
class Mapa:
    def __init__(self, cialo, W, H, ziarno):
        self.cialo, self.W, self.H = cialo, W, H
        self.R = R_KM[cialo]
        self.px_km = 2 * math.pi * self.R / W
        self.rng = np.random.default_rng(ziarno)
        self.kol = None
        self.noc = np.zeros((H, W, 3), np.float32)
        self.h = np.zeros((H, W), np.float32)            # wysokość [m] do mapy normalnych
        self.miejsca = []                                # (lon, lat, rodzaj) — węzły sieci dróg
        self.t0 = time.time()

    def log(self, m):
        print(f'[{self.cialo} {time.time() - self.t0:6.1f} s] {m}', flush=True)

    def okno(self, lon, lat, r_km):
        return okno(lon, lat, r_km, self.W, self.H, self.R)

    def mieszaj(self, rows, cols, barwa, t):
        sub = self.kol[np.ix_(rows, cols)]
        b = barwa if np.ndim(barwa) == 3 else np.asarray(barwa, np.float32)[None, None, :]
        self.kol[np.ix_(rows, cols)] = sub + (b - sub) * np.clip(t, 0, 1)[..., None]

    def swiec(self, rows, cols, barwa, t):
        self.noc[np.ix_(rows, cols)] += np.asarray(barwa, np.float32)[None, None, :] * t[..., None]

    def wysokosc(self, rows, cols, dh):
        self.h[np.ix_(rows, cols)] += dh

    def lonlat(self, lon0, lat0, x, y):
        """Punkty lokalne (km: x wschód, y północ) wokół (lon0, lat0) → stopnie."""
        lat = lat0 + np.degrees(np.asarray(y, np.float64) / self.R)
        lon = lon0 + np.degrees(np.asarray(x, np.float64) / (self.R * max(math.cos(math.radians(lat0)), 0.05)))
        return (lon + 180.0) % 360.0 - 180.0, lat

    def punkty(self, lons, lats, amp, r_km, barwa, cel='noc'):
        """Plamki gaussowskie w punktach (lon, lat) — światła (cel 'noc') albo maska dnia (cel = tablica (H, W)).
        Promień w km, nie mniej niż ~0,55 piksela; poziomo rozciągnięte jak mapa (1 / cos szerokości)."""
        lons = np.atleast_1d(np.asarray(lons, np.float64))
        lats = np.atleast_1d(np.asarray(lats, np.float64))
        if lons.size == 0:
            return
        amp = np.broadcast_to(np.asarray(amp, np.float64), lons.shape)
        r = np.broadcast_to(np.asarray(r_km, np.float64), lons.shape)
        W, H = self.W, self.H
        fi = (lons + 180.0) / 360.0 * W - 0.5
        fj = (90.0 - lats) / 180.0 * H - 0.5
        sy = np.maximum(r / self.px_km, 0.55)
        sx = sy / np.maximum(np.cos(np.radians(lats)), 0.2)
        k = int(min(12, math.ceil(3.0 * float(sx.max()))))
        i0 = np.round(fi).astype(np.int64)
        j0 = np.round(fj).astype(np.int64)
        warstwa = np.zeros((H, W), np.float32) if isinstance(cel, str) else cel
        for dj in range(-k, k + 1):
            jj = j0 + dj
            ok_j = (jj >= 0) & (jj < H)
            wy = np.exp(-0.5 * ((jj - fj) / sy) ** 2)
            for di in range(-k, k + 1):
                ii = i0 + di
                wgt = wy * np.exp(-0.5 * ((ii - fi) / sx) ** 2) * amp
                ok = ok_j & (wgt > 1e-3)
                if ok.any():
                    np.add.at(warstwa, (jj[ok], ii[ok] % W), wgt[ok].astype(np.float32))
        if isinstance(cel, str):
            self.noc += np.asarray(barwa, np.float32)[None, None, :] * warstwa[..., None]

    def kropki(self, lon0, lat0, x, y, maska, gestosc_1000km2, amp=(0.25, 1.0), r_km=None, barwa=None):
        """Rozproszone światła w oknie: losowe punkty z gęstością ∝ maska [szt./1000 km²], różne jasności
        i wielkości (bez kraty i bez konfetti barw — jedna barwa na wywołanie)."""
        pole = self.px_km * self.px_km * np.cos(np.radians(lat0))
        p = np.clip(maska * gestosc_1000km2 * pole / 1000.0, 0, 0.9)
        los = self.rng.random(p.shape)
        jj, ii = np.nonzero(los < p)
        if jj.size == 0:
            return 0
        n = jj.size
        xs = x[jj, ii] + (self.rng.random(n) - 0.5) * self.px_km
        ys = y[jj, ii] + (self.rng.random(n) - 0.5) * self.px_km
        lo, la = self.lonlat(lon0, lat0, xs, ys)
        a = self.rng.uniform(amp[0], amp[1], n) * self.rng.uniform(0.4, 1.0, n) ** 2
        rr = self.rng.uniform(0.35, 1.0, n) * (r_km if r_km else self.px_km * 0.75)
        self.punkty(lo, la, a, rr, barwa)
        return n


def rot(x, y, th):
    c, s = math.cos(th), math.sin(th)
    return x * c + y * s, -x * s + y * c


def pudelko(u, v, L, Sz, miekko):
    """Prostokąt o bokach L × Sz (km) z miękkim brzegiem."""
    return smoothstep(L / 2 + miekko, L / 2 - miekko, np.abs(u)) * smoothstep(Sz / 2 + miekko, Sz / 2 - miekko, np.abs(v))


def daleko_od(lon, lat, punkty, min_km, R):
    d = kierunek_z_lonlat(lon, lat)
    for a, b in punkty:
        if math.acos(max(-1.0, min(1.0, float(np.dot(d, kierunek_z_lonlat(a, b)))))) * R < min_km:
            return False
    return True


# ── Elementy wspólne: lądowisko, farma zbiorników, drogi ──────────────────────
def ladowisko(M, lon, lat, r_pola, n, barwa_pl, swiatla, swiatla2=None, ziarno=0, beacon=None, skala=1.0):
    """Pole lądowisk: n okrągłych płyt (spiekany grunt) luźno, z jaśniejszą aureolą wydmuchu; nocą
    światła obwodu (niepełne, nierówne łuki), czasem linia podejścia i światło w środku. `skala` — wielkość
    płyt (galileuszowe przy 2048 px: płyta 1–3 km byłaby poniżej teksela)."""
    r_pola *= skala
    rows, cols, x, y = M.okno(lon, lat, r_pola * 1.6)
    plyty = []
    for _ in range(n * 20):
        if len(plyty) >= n:
            break
        a = M.rng.uniform(0, 2 * math.pi)
        d = r_pola * math.sqrt(M.rng.uniform(0.0, 1.0))
        rp = M.rng.uniform(1.2, 3.2) * skala
        px, py = d * math.cos(a), d * math.sin(a)
        if all(math.hypot(px - qx, py - qy) > (rp + qr) * 1.6 for qx, qy, qr in plyty):
            plyty.append((px, py, rp))
    aur = np.zeros(x.shape, np.float32)
    pl = np.zeros(x.shape, np.float32)
    for k, (px, py, rp) in enumerate(plyty):
        d = np.sqrt((x - px) ** 2 + (y - py) ** 2)
        pl = np.maximum(pl, smoothstep(rp + 0.35 * skala, rp - 0.35 * skala, d))
        aur = np.maximum(aur, smoothstep(rp * 3.0, rp, d) * 0.5 * (0.7 + 0.6 * szum2(x, y, 1 / (2.5 * skala), ziarno + k)))
        # światła obwodu: łuk z przerwami, nierówne odstępy
        m = M.rng.integers(5, 10)
        kat0 = M.rng.uniform(0, 2 * math.pi)
        kat = kat0 + np.cumsum(M.rng.uniform(0.6, 1.3, m)) * (2 * math.pi / m / 0.95)
        kat = kat[M.rng.random(m) > 0.3]
        lo, la = M.lonlat(lon, lat, px + np.cos(kat) * rp * 1.05, py + np.sin(kat) * rp * 1.05)
        M.punkty(lo, la, M.rng.uniform(0.05, 0.22, kat.size), 0.25, swiatla)
        if M.rng.random() < 0.5:
            lo, la = M.lonlat(lon, lat, px, py)
            M.punkty(lo, la, M.rng.uniform(0.1, 0.3), min(rp * 0.25, 1.0), swiatla2 if swiatla2 is not None else swiatla)
        if M.rng.random() < 0.35:                              # linia podejścia
            kk = M.rng.uniform(0, 2 * math.pi)
            t = rp * 1.4 + np.arange(M.rng.integers(3, 6)) * M.rng.uniform(0.9, 1.4) * skala
            lo, la = M.lonlat(lon, lat, px + np.cos(kk) * t, py + np.sin(kk) * t)
            M.punkty(lo, la, np.linspace(0.3, 0.1, t.size), 0.22, swiatla)
        if beacon is not None and M.rng.random() < 0.5:
            lo, la = M.lonlat(lon, lat, px + rp * 1.3, py - rp * 0.4)
            M.punkty(lo, la, 0.3, 0.25, beacon)
    M.mieszaj(rows, cols, barwa_pl * 1.1, aur * 0.3)
    M.mieszaj(rows, cols, barwa_pl, pl * 0.8)
    M.wysokosc(rows, cols, pl * 30.0)
    return plyty


def farma_zbiornikow(M, lon, lat, r, n, barwa_zb, swiatla, ziarno=0, skala=1.0):
    """Farma zbiorników: okrągłe zbiorniki różnej wielkości w rzędach wzdłuż dwóch osi z przesunięciami
    i brakami, wał wokół, nocą rzadkie światła i kilka na obwodzie."""
    r *= skala
    rows, cols, x, y = M.okno(lon, lat, r * 1.5)
    th = M.rng.uniform(0, math.pi)
    zb = []
    krok = M.rng.uniform(2.6, 3.6) * skala
    for gi in range(-7, 8):
        for gj in range(-7, 8):
            if len(zb) >= n:
                break
            if M.rng.random() < 0.35:
                continue
            u = gi * krok + M.rng.normal(0, 0.35 * skala)
            v = gj * krok * M.rng.uniform(0.9, 1.25) + M.rng.normal(0, 0.35 * skala)
            if math.hypot(u, v) > r:
                continue
            px, py = rot(u, v, -th)
            zb.append((px, py, M.rng.uniform(0.55, 1.35) * skala))
    lo, la = M.lonlat(lon, lat, np.array([p[0] for p in zb]), np.array([p[1] for p in zb]))
    M.punkty(lo, la, 1.0, np.array([p[2] for p in zb]) * 0.8, None, cel=_lok_bufor(M))
    zbiorniki = _zbierz_bufor(M, rows, cols)
    d = np.sqrt(x * x + y * y) / (r * (0.85 + 0.3 * szum2(x, y, 1 / (6.0 * skala), ziarno)))
    wal = smoothstep(0.08, 0.0, np.abs(d - 1.12)) * 0.5
    teren = smoothstep(1.15, 0.95, d)
    M.mieszaj(rows, cols, barwa_zb * 0.6, teren * 0.12 * smoothstep(0.3, 0.7, szum2(x, y, 1 / (3.0 * skala), ziarno + 7)))
    M.mieszaj(rows, cols, barwa_zb * 0.85, wal * 0.8)
    M.mieszaj(rows, cols, barwa_zb, np.clip(zbiorniki * 1.4, 0, 1) * 0.85)
    M.wysokosc(rows, cols, np.clip(zbiorniki, 0, 1) * 60.0 + wal * 80.0)
    M.kropki(lon, lat, x, y, teren * (0.3 + 0.7 * np.clip(zbiorniki * 2, 0, 1)), 2.0 / skala ** 2, (0.08, 0.3), 0.3, swiatla)
    kat = np.sort(M.rng.uniform(0, 2 * math.pi, M.rng.integers(5, 10)))
    lo, la = M.lonlat(lon, lat, np.cos(kat) * r * 1.12, np.sin(kat) * r * 1.12)
    M.punkty(lo, la, M.rng.uniform(0.08, 0.25, kat.size), 0.25, swiatla)
    return len(zb)


_BUF = {}


def _lok_bufor(M):
    b = _BUF.get(id(M))
    if b is None or b.shape != (M.H, M.W):
        b = np.zeros((M.H, M.W), np.float32)
        _BUF[id(M)] = b
    b[:] = 0
    return b


def _zbierz_bufor(M, rows, cols):
    return _BUF[id(M)][np.ix_(rows, cols)].copy()


def drogi(M, wezly, barwa, swiatla, maks_km, skroty=1, skrot_km=None, gestosc_swiatel=0.05, szer=1.0, sila=0.35):
    """Drogi (trakty) między miejscami: drzewo rozpinające + skróty; za dnia lekko inny odcień gruntu,
    nocą PRZERYWANE światła — gęściej przy węzłach, rzadko w polu (ciągła linia czyta się jak graf)."""
    if len(wezly) < 2:
        return
    xyz, kraw = siec(wezly, M.R, maks_km, skroty, skrot_km or maks_km * 0.7)
    maska = np.zeros((M.H, M.W), np.float32)
    for a, b in kraw:
        res = linia(maska, xyz[a], xyz[b], M.W, M.H, M.R, waga=szer, meandry_km=M.R * 0.004, ziarno=a + 3 * b)
        if res is None:
            continue
        jj, ii, t = res
        dl = math.acos(max(-1.0, min(1.0, float(np.dot(xyz[a], xyz[b]))))) * M.R
        blisko = np.minimum(t, 1 - t) * dl                       # km od najbliższego końca
        p = gestosc_swiatel * (0.1 + 0.9 * np.exp(-blisko / 30.0))
        wyb = M.rng.random(t.size) < p * 0.35
        if wyb.any():
            lo, la = piksel_lonlat(jj[wyb], ii[wyb], M.W, M.H)
            M.punkty(lo, la, M.rng.uniform(0.04, 0.22, int(wyb.sum())), 0.2, swiatla)
    maska = np.clip(maska, 0, 1) * smoothstep(0.25, 0.55, pole_szumu(M.W, M.H, lambda x, y, z: fbm3(x, y, z, 40.0, 3, 77)) + 0.2)
    M.kol = mix(M.kol, M.kol * 0.82 + barwa * 0.08, maska * sila)
    M.h -= maska * 25.0


def piksel_lonlat(j, i, W, H):
    return (np.asarray(i) + 0.5) / W * 360 - 180, 90 - (np.asarray(j) + 0.5) / H * 180


def zapisz(M, wyj, podglady, prefix):
    kol_srgb = lin_do_srgb(M.kol)
    L = luminancja(M.noc)
    Lk = np.where(L > 0.35, 0.35 + (L - 0.35) / (1.0 + (L - 0.35) / 0.3), L)          # sufit ~0,65
    noc = M.noc * (Lk / np.maximum(L, 1e-6))[..., None]
    noc_srgb = lin_do_srgb(np.clip(noc, 0, 1))
    nrm = normalne_z_wysokosci(M.h, M.R * 1000.0, PRZEWYZSZENIE[M.cialo])
    zapisz_rgb(os.path.join(wyj, f'{prefix}_hf_color.jpg'), kol_srgb, 92)
    zapisz_rgb(os.path.join(wyj, f'{prefix}_hf_night.jpg'), noc_srgb, 92)
    zapisz_normalne(os.path.join(wyj, f'{prefix}_hf_normal.jpg'), nrm, 95)
    # podgląd: dzień, noc, normalne i „noc na dniu” (gdzie leżą światła względem gruntu)
    razem = np.clip(kol_srgb * 0.45 + noc_srgb * 1.2, 0, 1)
    for nazwa, a in (('kolor', kol_srgb), ('noc', noc_srgb), ('normalne', nrm * 0.5 + 0.5), ('razem', razem)):
        podglad(os.path.join(podglady, f'{M.cialo}-{nazwa}.png'), a)
    import json
    with open(os.path.join(podglady, f'{M.cialo}-miejsca.json'), 'w', encoding='utf-8') as f:
        json.dump([[round(a, 2), round(b, 2), c] for a, b, c in M.miejsca], f)
    M.log(f'zapis → {wyj}  miejsca: ' + ', '.join(f'{c} ({a:.0f}, {b:.0f})' for a, b, c in M.miejsca))


def rozciagnij(v, p0=1.5, p1=99.0):
    """Rozciągnięcie jasności mozaiki do [0, 1] po percentylach (mozaiki USGS mają różny zakres łat)."""
    lo, hi = np.percentile(v[::4, ::4], [p0, p1])
    return np.clip((v - lo) / max(hi - lo, 1e-3), 0, 1).astype(np.float32)


def detal(v, px_km, km, lo=0.55, hi=1.7):
    """Detal jasności względem tła ~km (mnożnik) — rysunek mozaiki na barwie z palety."""
    return np.clip((v + 0.04) / np.maximum(rozmyj_kula(v, max(1.0, km / px_km)) + 0.04, 1e-3), lo, hi).astype(np.float32)


def do_sredniej(kol, cel, H, W):
    """Barwa przeskalowana do średniej jasności liniowej `cel` (ważonej polem)."""
    lat = np.linspace(90 - 90 / H, -90 + 90 / H, H, dtype=np.float32)[:, None]
    sr = float(np.average(luminancja(kol), weights=np.cos(np.radians(lat)) * np.ones((1, W))))
    return np.clip(kol * (cel / max(sr, 1e-4)), 0, 1).astype(np.float32)


# Średnia jasność liniowa map dnia (ważona polem). Luna z LROC ma ~0,29 i w grze wygląda dobrze; galileuszowe
# względem niej wg albedo (Io 0,63, Europa 0,67, Ganimedes 0,43, Kallisto 0,22 — skala ściśnięta pierwiastkiem,
# bo pełny stosunek przepaliłby Europę i Io), dawne mapy gry były wyblakłe (Ganimedes, Kallisto za jasne).
JASNOSC = dict(io=0.45, europa=0.52, ganimedes=0.42, kallisto=0.26)


def _losuj(M, maska, n, odstep_deg):
    kand = np.argwhere(maska[::4, ::4]) * 4
    out = []
    for k in M.rng.permutation(len(kand)):
        j, i = kand[k]
        lo, la = (i + 0.5) / M.W * 360 - 180, 90 - (j + 0.5) / M.H * 180
        if all(math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(kierunek_z_lonlat(lo, la), kierunek_z_lonlat(a, b))))))) > odstep_deg for a, b in out):
            out.append((lo, la))
        if len(out) >= n:
            break
    return out


# ── LUNA: Terra Nova, węzeł bez wydobycia ─────────────────────────────────────
def luna(W, H):
    M = Mapa('luna', W, H, 41)
    kol, h = wczytaj_lune(W, H)
    M.kol = kol.copy()
    M.h = h.copy()
    M.log('LROC + LOLA')
    rel = h - rozmyj_kula(h, max(1.0, 30.0 / M.px_km))
    nachylenie = rozmyj_kula(np.abs(rel), max(1.0, 8.0 / M.px_km))
    PAL = {k: kolor(v) for k, v in dict(
        plac='#8f8b85', plyta='#bdb9b1', metal='#8a8d91', dok='#3f3f40', kadlub='#9a9da2', suwnica='#7c7f84',
        hala='#9b9b99', bunkier='#5f5d59', wal='#a19c93', droga='#6a6762',
    ).items()}

    # aneks stoczni: suche doki na południu Mare Imbrium (płasko) — nie równa drabina: różne długości, szerokości,
    # przesunięcia i lekko rozbieżne kierunki; plac stoczni (wyrównany regolit), hale montażowe, składy
    lon0, lat0 = -16.0, 29.0
    th = math.radians(24.0)
    rows, cols, x, y = M.okno(lon0, lat0, 130.0)
    u0, v0 = rot(x, y, th)
    plac = smoothstep(1.0, 0.6, np.sqrt((u0 / 62.0) ** 2 + ((v0 + 8) / 58.0) ** 2) + 0.45 * (szum2(x, y, 1 / 22.0, 3) - 0.5)
                      + 0.2 * (szum2(x, y, 1 / 6.0, 4) - 0.5)) * (0.5 + 0.5 * szum2(x, y, 1 / 9.0, 5))
    dok_m = np.zeros(x.shape, np.float32)
    dno = np.zeros(x.shape, np.float32)
    kadl = np.zeros(x.shape, np.float32)
    suw = np.zeros(x.shape, np.float32)
    off = -38.0
    for k in range(5):
        L = M.rng.uniform(30, 66)
        Sz = M.rng.uniform(8.0, 13.0)
        tk = th + math.radians(M.rng.uniform(-4.0, 4.0))
        sdv = off
        sdu = M.rng.uniform(-14, 14)
        off += Sz + M.rng.uniform(7.0, 15.0)
        if M.rng.random() < 0.18:                            # luka w rzędzie (rozbiórka / plac)
            continue
        u, v = rot(x, y, tk)
        uu, vv = u - sdu, v - sdv
        brzeg = (szum2(x, y, 1 / 3.0, k) - 0.5) * 0.8
        dok_m = np.maximum(dok_m, pudelko(uu, vv, L + 4.0, Sz + 4.0, 1.3 + brzeg * 0.5))
        dno = np.maximum(dno, pudelko(uu, vv, L, Sz, 1.1))
        if M.rng.random() < 0.7:                               # okręt w doku (kadłub w budowie, segmenty)
            fr = M.rng.uniform(0.45, 0.85)
            seg = 0.9 + 0.12 * smoothstep(0.3, 0.7, szum2(uu / 14.0, vv / 4.0, 1.0, k + 50))
            kadl = np.maximum(kadl, pudelko(uu - L * (0.5 - fr / 2) * M.rng.choice([-1, 1]), vv, L * fr, Sz * M.rng.uniform(0.45, 0.65), 0.6) * seg)
        # noc: krawędzie doku przerywane, spawy na dnie (kilka), czerwone znaki na końcach
        n = int(L / M.rng.uniform(4.0, 7.0))
        tt = np.sort(M.rng.uniform(-L / 2, L / 2, n))
        for strona in (-1, 1):
            zost = M.rng.random(n) > 0.55
            pu, pv = tt[zost], np.full(int(zost.sum()), strona * (Sz / 2 + 1.0)) + M.rng.normal(0, 0.3, int(zost.sum()))
            px, py = rot(pu + sdu, pv + sdv, -tk)
            lo, la = M.lonlat(lon0, lat0, px, py)
            M.punkty(lo, la, M.rng.uniform(0.06, 0.26, lo.size), 0.3, NOC['tn_biel'])
        ns = int(M.rng.integers(0, 4))
        if ns:
            px, py = rot(M.rng.uniform(-L / 2.5, L / 2.5, ns) + sdu, M.rng.normal(0, Sz / 6, ns) + sdv, -tk)
            lo, la = M.lonlat(lon0, lat0, px, py)
            M.punkty(lo, la, M.rng.uniform(0.3, 0.6, ns), 0.35, NOC['spaw'])
        if M.rng.random() < 0.6:
            px, py = rot(np.array([L / 2 + 1.5]) * M.rng.choice([-1, 1]) + sdu, np.array([0.0]) + sdv, -tk)
            lo, la = M.lonlat(lon0, lat0, px, py)
            M.punkty(lo, la, 0.25, 0.25, NOC['czerwien'])
    M.mieszaj(rows, cols, PAL['plac'], plac * 0.16)
    M.mieszaj(rows, cols, PAL['wal'], dok_m * 0.32)
    M.mieszaj(rows, cols, PAL['dok'], dno * 0.6)
    M.mieszaj(rows, cols, PAL['kadlub'], kadl * 0.75)
    M.mieszaj(rows, cols, PAL['suwnica'], suw * dok_m * 0.45)
    M.wysokosc(rows, cols, dok_m * 150.0 - dno * 1100.0 + kadl * 650.0 + suw * dok_m * 300.0)
    # hale montażowe i składy (po stronie lądu), różnej wielkości, rozrzucone
    hm = np.zeros(x.shape, np.float32)
    for k in range(int(M.rng.integers(5, 9))):
        hu, hv = M.rng.uniform(-40, 40), M.rng.uniform(-66, -46)
        uu, vv = rot(x - 0, y - 0, th + M.rng.uniform(-0.1, 0.1))
        m = pudelko(uu - hu, vv - hv, M.rng.uniform(5, 15), M.rng.uniform(3, 8), 0.45)
        M.mieszaj(rows, cols, PAL['hala'] * (0.85 + 0.25 * M.rng.random()), m * 0.7)
        hm = np.maximum(hm, m)
    M.wysokosc(rows, cols, hm * 350.0)
    M.kropki(lon0, lat0, x, y, hm, 4.0, (0.06, 0.3), 0.3, NOC['tn_cieplo'])
    M.kropki(lon0, lat0, x, y, plac * (1 - dok_m), 0.12, (0.05, 0.2), 0.3, NOC['tn_biel'])
    M.miejsca.append((lon0, lat0, 'stocznia'))
    ladowisko(M, -9.0, 24.5, 18.0, 6, PAL['plyta'], NOC['tn_biel'], NOC['tn_niebo'], 3, NOC['czerwien'])
    M.miejsca.append((-9.0, 24.5, 'ladowisko'))
    M.log('stocznia')

    # depoty: farmy zbiorników na płaskich morzach z lądowiskiem obok
    for k, (lo, la) in enumerate([(26.0, 7.0), (19.0, 21.5), (-14.0, -19.0)]):
        farma_zbiornikow(M, lo, la, M.rng.uniform(10, 16), int(M.rng.integers(18, 40)), PAL['metal'] * 1.25, NOC['tn_biel'], k + 10)
        ladowisko(M, lo + M.rng.uniform(-1.4, 1.4), la + M.rng.choice([-1, 1]) * M.rng.uniform(0.9, 1.4), 12.0,
                  int(M.rng.integers(3, 6)), PAL['plyta'], NOC['tn_biel'], NOC['tn_niebo'], k + 20, NOC['czerwien'])
        M.miejsca.append((lo, la, 'depot'))
    M.log('depoty')

    # garnizony: bunkry wkopane (ciemne prostokąty z wałem), kopuły radarów; nocą niewiele światła
    for k, (lo0, la0) in enumerate([(-52.0, 8.0), (-38.0, -6.0), (34.0, -14.5), (-63.0, 27.0)]):
        rows, cols, x, y = M.okno(lo0, la0, 30.0)
        thg = M.rng.uniform(0, math.pi)
        u, v = rot(x, y, thg)
        m_b = np.zeros(x.shape, np.float32)
        for q in range(int(M.rng.integers(4, 9))):
            bu, bv = M.rng.uniform(-14, 14), M.rng.uniform(-10, 10)
            bL, bS = M.rng.uniform(2.5, 6.0), M.rng.uniform(1.6, 3.5)
            m_b = np.maximum(m_b, pudelko(u - bu, v - bv, bL, bS, 0.35))
            if M.rng.random() < 0.6:
                px, py = rot(np.array([bu + bL / 2]), np.array([bv]), -thg)
                lo, la = M.lonlat(lo0, la0, px, py)
                M.punkty(lo, la, M.rng.uniform(0.06, 0.2), 0.25, NOC['tn_biel'] if q % 3 else NOC['czerwien'])
        rad = np.zeros(x.shape, np.float32)
        for q in range(int(M.rng.integers(1, 4))):
            cx, cy = M.rng.uniform(-18, 18), M.rng.uniform(-14, 14)
            rad = np.maximum(rad, smoothstep(1.6, 0.9, np.sqrt((x - cx) ** 2 + (y - cy) ** 2)))
        wal = smoothstep(2.2, 0.6, ndi.distance_transform_edt(m_b < 0.5) * M.px_km) * (m_b < 0.5)
        M.mieszaj(rows, cols, PAL['wal'], wal * 0.3)
        M.mieszaj(rows, cols, PAL['bunkier'], m_b * 0.75)
        M.mieszaj(rows, cols, PAL['plyta'], rad * 0.8)
        M.wysokosc(rows, cols, m_b * 220.0 + wal * 150.0 + rad * 250.0)
        ladowisko(M, lo0 + M.rng.uniform(-0.8, 0.8), la0 + M.rng.uniform(0.7, 1.2), 9.0, int(M.rng.integers(2, 5)),
                  PAL['plyta'], NOC['tn_biel'], None, k + 40, NOC['czerwien'])
        M.miejsca.append((lo0, la0, 'garnizon'))
    M.log('garnizony')

    # port główny na Sinus Medii — największe pole lądowisk; placówki (radary, przekaźniki) po całej kuli
    ladowisko(M, 1.5, 1.0, 26.0, 11, PAL['plyta'], NOC['tn_biel'], NOC['tn_niebo'], 60, NOC['czerwien'])
    farma_zbiornikow(M, 3.2, -0.6, 7.0, 14, PAL['metal'] * 1.25, NOC['tn_biel'], 61)
    M.miejsca.append((1.5, 1.0, 'port'))
    plaskie = (nachylenie < np.percentile(nachylenie, 45)) & (np.abs(np.linspace(90, -90, H))[:, None] < 70)
    plac_l = []
    for (lo, la) in _losuj(M, plaskie, 34, 9.0):
        if not daleko_od(lo, la, [(a, b) for a, b, _ in M.miejsca], 120.0, M.R):
            continue
        rows, cols, x, y = M.okno(lo, la, 8.0)
        d = np.sqrt(x * x + y * y)
        M.mieszaj(rows, cols, PAL['plyta'], smoothstep(1.6, 0.9, d) * 0.55)
        n = int(M.rng.integers(1, 4))
        lo2, la2 = M.lonlat(lo, la, M.rng.normal(0, 1.2, n), M.rng.normal(0, 1.2, n))
        M.punkty(lo2, la2, M.rng.uniform(0.06, 0.25, n), 0.3, NOC['tn_biel'])
        if M.rng.random() < 0.5:
            M.punkty([lo], [la], M.rng.uniform(0.12, 0.25), 0.25, NOC['czerwien'])
        plac_l.append((lo, la))
    M.log(f'placówki {len(plac_l)}')

    # drogi między bazami bliskiej strony (rozjeżdżony regolit ciemniejszy), światła przerywane
    wezly = [(a, b) for a, b, _ in M.miejsca] + [p for p in plac_l if abs(p[0]) < 75]
    drogi(M, wezly, PAL['droga'], NOC['tn_biel'], maks_km=700.0, skroty=1, skrot_km=420.0, gestosc_swiatel=0.06, sila=0.3)
    M.log('drogi')
    return M


# ── IO: kopalnia metalu Konsorcjum ────────────────────────────────────────────
# Czynne paterae (lon wsch., lat, siła) — słaby żar lawy nocą (gorące punkty z obserwacji Galileo NIMS)
IO_GORACE = [(51.0, 13.0, 1.6), (105.0, -19.0, 1.0), (116.0, -12.0, 0.7), (150.0, -28.0, 0.7), (88.0, -39.0, 0.5),
             (-153.0, -1.5, 0.8), (-115.0, 24.0, 0.7), (-124.0, 63.0, 0.6), (-160.0, -20.0, 0.5), (-173.0, 18.0, 0.5),
             (-56.0, -45.0, 0.5), (-37.0, -16.0, 0.5), (-90.0, 16.0, 0.6), (-133.0, 39.0, 0.5), (-39.0, -3.0, 0.4)]


def io(W, H):
    M = Mapa('io', W, H, 53)
    v, w = wczytaj_szara('io', W, H)
    v = wypelnij(v, w, 5, M.px_km)
    stara = wczytaj_obraz(os.path.join(KATALOG_REPO, 'public/assets/planety/images/jupiterIo.jpg'), W, H)
    # barwa: chroma starej mapy (rozmyta — szwy i łaty starej mozaiki) × jasność mozaiki USGS
    ch = np.stack([rozmyj_kula(stara[..., c], max(1.0, 30.0 / M.px_km)) for c in range(3)], -1)
    chroma = ch / np.maximum(luminancja(ch)[..., None], 1e-4)
    chroma = 1.0 + (chroma - 1.0) * 0.5                     # stara mapa była przesycona (barwy wzmocnione)
    vs = rozciagnij(v, 0.5, 99.7)
    L = srgb_do_lin(0.12 + 0.88 * vs)
    M.kol = do_sredniej(chroma * L[..., None], JASNOSC['io'], H, W)
    M.h = ((v - rozmyj_kula(v, max(1.0, 40.0 / M.px_km))) * 1800.0).astype(np.float32)   # paterae (ciemne) niżej
    M.log('mozaika + barwa')
    PAL = {k: kolor(v_) for k, v_ in dict(
        sciana='#6b625a', dno='#3b3734', fe='#7e5038', ti='#5c6168', cu='#5a6656', halda='#8a8072', pyl='#7a7062',
        zaklad='#4a4745', zuzel='#5e4232', plyta='#aaa69e', droga='#5c544d',
    ).items()}

    # żar czynnych paterae (natura, nie przemysł) — małe, nierówne, przygaszone
    for k, (lo, la, s) in enumerate(IO_GORACE):
        n = int(3 + 5 * s)
        lo2, la2 = M.lonlat(lo, la, M.rng.normal(0, 14 * s, n), M.rng.normal(0, 10 * s, n))
        M.punkty(lo2, la2, M.rng.uniform(0.03, 0.14, n) * s, M.rng.uniform(2.0, 6.0, n) * s, NOC['lawa'])

    # odkrywki: z dala od paterae i od siebie, na równinach (nie w ciemnych misach lawy)
    gorace = [(a, b) for a, b, _ in IO_GORACE]
    rowne = (vs > np.percentile(vs, 35)) & (np.abs(np.linspace(90, -90, H))[:, None] < 48)
    rodz = ['fe', 'ti', 'cu', 'fe', 'cu', 'ti']
    kopalnie = []
    for (lo, la) in _losuj(M, rowne, 60, 24.0):
        if len(kopalnie) >= 6:
            break
        if daleko_od(lo, la, gorace, 420.0, M.R):
            kopalnie.append((lo, la))
    for k, (lo, la) in enumerate(kopalnie):
        odkrywka(M, lo, la, M.rng.uniform(40, 66) * (1.35 if k == 0 else 1.0), PAL, PAL[rodz[k]], k)
        M.miejsca.append((lo, la, 'kopalnia'))
    M.log(f'odkrywki {len(kopalnie)}')

    # porty przy dwóch kopalniach; przy największej — tor wyrzutni masy (eksport rudy na orbitę)
    for k in (0, 3):
        lo, la = kopalnie[k]
        lo2, la2 = M.lonlat(lo, la, np.array([150.0]), np.array([-60.0]))
        ladowisko(M, float(lo2[0]), float(la2[0]), 14.0, int(M.rng.integers(4, 7)), PAL['plyta'], NOC['biel'], NOC['sod'], k + 80,
                  NOC['fiolet'], skala=2.2)
        M.miejsca.append((float(lo2[0]), float(la2[0]), 'port'))
    wyrzutnia(M, *kopalnie[0], PAL)
    drogi(M, [(a, b) for a, b, _ in M.miejsca], PAL['droga'], NOC['sod'], maks_km=1600.0, skroty=0, gestosc_swiatel=0.04, szer=1.2, sila=0.3)
    M.log('porty, wyrzutnia, drogi')
    return M


def odkrywka(M, lon, lat, r, PAL, ruda, ziarno):
    """Odkrywka tarasowa: obrys z 2–3 płatów (wyrobisko idzie za złożem), stopnie nierówne i nie współśrodkowe
    (szum na numerze stopnia), wysokość schodkowa (ostre krawędzie w mapie normalnych), ściany w barwie odsłoniętej
    skały z tonem rudy w płatach; hałdy płatami przy krawędzi w barwie gruntu, zakład z hutą, droga urobku, pył.
    Nocą: rzadki sód na krawędzi i stopniach, skupisko przy przodku na dnie, zakład, żar huty."""
    rows, cols, x, y = M.okno(lon, lat, r * 2.4)
    th = M.rng.uniform(0, math.pi)
    d = np.full(x.shape, 9.0, np.float32)
    for q in range(int(M.rng.integers(2, 4))):                 # płaty wyrobiska
        a = M.rng.uniform(0, 2 * math.pi)
        o = r * (0.0 if q == 0 else M.rng.uniform(0.3, 0.55))
        rq = r * (1.0 if q == 0 else M.rng.uniform(0.5, 0.75))
        ex = M.rng.uniform(0.7, 1.35)
        uu, vv = rot(x - o * math.cos(a), y - o * math.sin(a), th + M.rng.uniform(-0.6, 0.6))
        d = np.minimum(d, np.sqrt((uu / ex) ** 2 + (vv * ex) ** 2) / rq)
    d = d * (1.0 + 0.12 * (szum2(x, y, 1 / (r * 0.3), ziarno) - 0.5))
    wn = smoothstep(1.0, 0.95, d)
    n_st = int(M.rng.integers(6, 10))
    st = np.clip(1.0 - d, 0, 1) ** 0.85 * n_st + 0.9 * (szum2(x, y, 1 / (r * 0.18), ziarno + 1) - 0.5)
    poz = np.clip(np.floor(st), 0, n_st)
    fr = st - np.floor(st)
    kraw = smoothstep(0.84, 0.97, fr)                        # krawędź stopnia (wyżej) — jaśniejsza
    grunt = M.kol[np.ix_(rows, cols)]
    szary = luminancja(grunt)[..., None]
    skala_ = mix(grunt * 0.35 + szary * 0.65, PAL['sciana'][None, None, :] * np.ones_like(grunt), 0.6)
    plamy = smoothstep(0.5, 0.7, szum2(x, y, 1 / (r * 0.22), ziarno + 2))
    skala_ = mix(skala_, ruda, 0.2 + 0.35 * plamy)
    skala_ = skala_ * (0.8 + 0.22 * (poz % 2))[..., None] * (0.9 + 0.35 * kraw[..., None])
    b = mix(skala_, PAL['dno'], smoothstep(0.32, 0.06, d) * 0.8)
    # pył urobku wokół (siarka szarzeje)
    M.mieszaj(rows, cols, PAL['pyl'], smoothstep(2.2, 1.05, d) * 0.22 * (0.6 + 0.6 * szum2(x, y, 1 / 18.0, ziarno + 3)))
    # hałdy: płaty przy krawędzi (nie pełny pierścień), barwa gruntu poszarzała
    h_m = np.zeros(x.shape, np.float32)
    for q in range(int(M.rng.integers(2, 5))):
        a = M.rng.uniform(0, 2 * math.pi)
        dh = r * M.rng.uniform(1.25, 1.55)
        cx, cy = dh * math.cos(a), dh * math.sin(a)
        rr = r * M.rng.uniform(0.28, 0.5)
        eu, ev = rot(x - cx, y - cy, a + math.pi / 2)        # wydłużone wzdłuż krawędzi
        dm = np.sqrt((eu / 1.8) ** 2 + ev ** 2) / (rr * (0.75 + 0.5 * szum2(x, y, 1 / (rr * 0.5), ziarno + 10 + q)))
        h_m = np.maximum(h_m, smoothstep(1.0, 0.45, dm))
    grunt = M.kol[np.ix_(rows, cols)]
    halda = mix(grunt * 0.4 + luminancja(grunt)[..., None] * 0.6, PAL['halda'], 0.5) * (0.85 + 0.3 * szum2(x, y, 1 / 5.0, ziarno + 4))[..., None]
    M.mieszaj(rows, cols, halda, h_m * 0.75 * (1 - wn))
    M.mieszaj(rows, cols, b, wn * 0.95)
    glebokosc = M.rng.uniform(5000, 8000)
    M.wysokosc(rows, cols, -(poz / n_st) * glebokosc * wn + h_m * 900.0 * (1 - wn))
    # zakład i huta, droga urobku od krawędzi
    za = M.rng.uniform(0, 2 * math.pi)
    zx, zy = r * 1.7 * math.cos(za), r * 1.7 * math.sin(za)
    zm = np.zeros(x.shape, np.float32)
    for q in range(int(M.rng.integers(3, 6))):
        bx, by = zx + M.rng.normal(0, 5.0), zy + M.rng.normal(0, 5.0)
        uu, vv = rot(x - bx, y - by, th + M.rng.uniform(-0.2, 0.2))
        zm = np.maximum(zm, pudelko(uu, vv, M.rng.uniform(5, 13), M.rng.uniform(3, 7), 0.5))
    hx, hy = zx + 8.0 * math.cos(za + 1.0), zy + 8.0 * math.sin(za + 1.0)
    zuz = smoothstep(1.0, 0.35, np.sqrt((x - hx) ** 2 + (y - hy) ** 2) / (r * 0.2) + 0.35 * szum2(x, y, 1 / 3.0, ziarno + 5))
    t = np.clip(((x * zx + y * zy) / (zx * zx + zy * zy)), 0, 1)
    dd = np.sqrt((x - t * zx) ** 2 + (y - t * zy) ** 2)
    droga = smoothstep(2.2, 0.6, dd) * smoothstep(0.55, 0.7, t + 0.0 * dd) * (1 - wn)
    M.mieszaj(rows, cols, PAL['droga'], droga * 0.45)
    M.mieszaj(rows, cols, PAL['zuzel'], zuz * 0.65)
    M.mieszaj(rows, cols, PAL['zaklad'], zm * 0.85)
    M.wysokosc(rows, cols, zm * 400.0 + zuz * 250.0)
    # noc: krawędź (przerywana), stopnie (rzadko), przodek na dnie, zakład, huta
    kat = np.concatenate([M.rng.uniform(a0, a0 + M.rng.uniform(0.5, 1.4), int(M.rng.integers(3, 8)))
                          for a0 in M.rng.uniform(0, 2 * math.pi, int(M.rng.integers(2, 4)))])
    rr_ = r * M.rng.uniform(0.93, 1.08, kat.size)
    lo2, la2 = M.lonlat(lon, lat, np.cos(kat) * rr_, np.sin(kat) * rr_)
    M.punkty(lo2, la2, M.rng.uniform(0.05, 0.22, kat.size), 0.3, NOC['sod'])
    M.kropki(lon, lat, x, y, kraw * wn * smoothstep(0.15, 0.3, d), 3.0, (0.04, 0.2), 0.3, NOC['sod'])
    M.kropki(lon, lat, x, y, smoothstep(0.28, 0.0, d) * wn, 4.0, (0.15, 0.5), 0.35, NOC['biel'])
    M.kropki(lon, lat, x, y, zm, 12.0, (0.08, 0.35), 0.35, NOC['sod'])
    lo2, la2 = M.lonlat(lon, lat, np.array([hx]), np.array([hy]))
    M.punkty(lo2, la2, 0.55, r * 0.035, NOC['huta'])
    M.punkty(lo2, la2, 0.14, r * 0.12, NOC['huta'])
    M.kropki(lon, lat, x, y, droga, 3.0, (0.04, 0.16), 0.3, NOC['sod'])


def wyrzutnia(M, lon, lat, PAL):
    """Tor wyrzutni masy: prosty, długi, z rzadkimi światłami w nierównych odstępach (nie ciągła linia)."""
    th = M.rng.uniform(0, math.pi)
    Lw = 210.0
    x0, y0 = 105.0 * math.cos(th + 1.3), 105.0 * math.sin(th + 1.3)
    lo, la = M.lonlat(lon, lat, np.array([x0, x0 + Lw * math.cos(th)]), np.array([y0, y0 + Lw * math.sin(th)]))
    A, B = kierunek_z_lonlat(lo[0], la[0]), kierunek_z_lonlat(lo[1], la[1])
    maska = np.zeros((M.H, M.W), np.float32)
    linia(maska, A, B, M.W, M.H, M.R, waga=1.0)
    maska = np.clip(maska, 0, 1)
    M.kol = mix(M.kol, PAL['zaklad'] * 1.2, maska * 0.55)
    M.h += maska * 150.0
    n = 22
    tt = np.sort(M.rng.uniform(0, Lw, n))
    tt = tt[M.rng.random(n) > 0.3]
    lo2, la2 = M.lonlat(lon, lat, x0 + tt * math.cos(th), y0 + tt * math.sin(th))
    M.punkty(lo2, la2, M.rng.uniform(0.04, 0.16, lo2.size), 0.3, NOC['biel'])
    lo2, la2 = M.lonlat(lon, lat, np.array([x0 + Lw * math.cos(th)]), np.array([y0 + Lw * math.sin(th)]))
    M.punkty(lo2, la2, 0.3, 0.5, NOC['fiolet'])


# ── EUROPA: kopalnia lodu Unii Pasa ───────────────────────────────────────────
def europa(W, H):
    M = Mapa('europa', W, H, 67)
    v, w = wczytaj_szara('europa', W, H)
    v = wypelnij(v, w, 7, M.px_km)
    vs = rozciagnij(v, 1.0, 99.5)
    lon = np.linspace(-180 + 180 / W, 180 - 180 / W, W, dtype=np.float32)[None, :]
    lat = np.linspace(90 - 90 / H, -90 + 90 / H, H, dtype=np.float32)[:, None]
    # półkula wsteczna (apeks 90° E = 270° W) ciemniejsza i bardziej ruda (siarka z magnetosfery), wiodąca
    # (90° W) jaśniejsza i chłodniejsza
    wsteczna = (0.5 + 0.5 * np.cos(np.radians(lon - 90.0)) * np.cos(np.radians(lat))).astype(np.float32)
    PAL = {k: kolor(v_) for k, v_ in dict(
        lod='#e9e3d7', lod_nieb='#d8e0e4', braz='#9c7a62', rdza='#80563f', ciemny='#5f4334',
        swiezy='#f4f7f7', sciana='#dfe6e9', dno='#a3b0b8', gruz='#eaeded', platforma='#4d545b', kopula='#c3ccd3',
        droga='#a09a90',
    ).items()}
    tlo = rozmyj_kula(vs, max(1.0, 60.0 / M.px_km))
    lineae = smoothstep(0.62, 0.22, vs)                               # ciemne pasma, chaos
    szeroko = smoothstep(0.62, 0.3, tlo)                              # rozległe ciemne obszary (chaos, plamy)
    baza = mix(PAL['lod'][None, None, :] * np.ones((H, W, 1), np.float32), PAL['lod_nieb'], smoothstep(0.45, 0.85, 1 - wsteczna) * 0.7)
    plamy = mix(PAL['braz'][None, None, :] * np.ones((H, W, 1), np.float32), PAL['rdza'], smoothstep(0.35, 0.85, wsteczna))
    plamy = mix(plamy, PAL['ciemny'], smoothstep(0.55, 0.95, lineae) * 0.55)
    t = np.clip(lineae * 0.85 + szeroko * 0.35, 0, 1) * (0.65 + 0.45 * wsteczna)
    kol = mix(baza, plamy, np.clip(t, 0, 1))
    kol = kol * detal(vs, M.px_km, 25.0, 0.7, 1.25)[..., None] ** 0.5 * (1.0 - 0.22 * wsteczna)[..., None]
    M.kol = do_sredniej(kol, JASNOSC['europa'], H, W)
    # rzeźba: ciemne lineae to podwójne grzbiety (wyżej), szeroki chaos niżej
    hp = vs - rozmyj_kula(vs, max(1.0, 10.0 / M.px_km))
    M.h = (-hp * 900.0 - (lineae - rozmyj_kula(lineae, max(1.0, 80.0 / M.px_km))) * 250.0).astype(np.float32)
    M.log('mozaika + barwa')

    # spękania (lineae): wąskie ciemne pasma mozaiki — po nich idą cięcia
    pasma = rozmyj_kula(vs, 0.6) - rozmyj_kula(vs, max(1.0, 14.0 / M.px_km))
    spek = smoothstep(0.035, 0.1, -pasma).astype(np.float32)
    gestosc = rozmyj_kula(spek, max(1.0, 50.0 / M.px_km))
    M.log(f'spękania: {100 * float((spek > 0.5).mean()):.1f}% pikseli')
    # pola kopalni: gęsto spękane jasne równiny z dala od biegunów i od siebie; pierwsze = baza Unii Pasa
    kand = (gestosc > np.percentile(gestosc, 80)) & (tlo > 0.42) & (np.abs(lat) < 45) * np.ones((1, W), bool)
    pola = []
    for (lo, la) in _losuj(M, kand, 80, 40.0):
        if len(pola) >= 4:
            break
        pola.append((lo, la))
    for k, (lo, la) in enumerate(pola):
        pole_ciec(M, lo, la, spek, PAL, k, baza=(k == 0))
        M.miejsca.append((lo, la, 'kopalnia'))
    M.log(f'pola cięć {len(pola)}')
    drogi(M, [(a, b) for a, b, _ in M.miejsca], PAL['droga'], NOC['up_ziel'], maks_km=1500.0, skroty=0, gestosc_swiatel=0.03, szer=1.0, sila=0.3)
    return M


def pole_ciec(M, lon, lat, spek, PAL, ziarno, baza=False):
    """Pole cięć w lodzie WZDŁUŻ PRAWDZIWYCH SPĘKAŃ: z lineae wykrytych w mozaice (maska `spek`) brane są
    najdłuższe pasma blisko środka pola, na każdym odcinek 50–160 km poszerzony w rów (świeży lód jasny
    i chłodny, ściany, dno w cieniu, gruz obok) — rów idzie łukami spękania, nie po linijce. Na końcu odcinka
    przodek z platformą; hub pola (w bazie Unii Pasa kopuły) i lądowisko. Nocą: przodki, kilka świateł przy
    przodkach, platformy i hub w zieleni Unii Pasa."""
    R_pola = M.rng.uniform(150, 200) * (1.2 if baza else 1.0)
    rows, cols, x, y = M.okno(lon, lat, R_pola * 1.3)
    m = spek[np.ix_(rows, cols)] > 0.5
    lab, n = ndi.label(m, structure=np.ones((3, 3)))
    dx_km = M.px_km * max(math.cos(math.radians(lat)), 0.2)
    kand = []
    for k, sl in enumerate(ndi.find_objects(lab)):
        if sl is None:
            continue
        jj, ii = np.nonzero(lab[sl] == k + 1)
        px, py = x[sl][jj, ii], y[sl][jj, ii]
        if px.size < 6 or math.hypot(float(px.max() - px.min()), float(py.max() - py.min())) < 45.0:
            continue
        d = np.sqrt(px * px + py * py)
        if float(d.min()) > R_pola * 0.8:
            continue
        kand.append((float(d.min()) + M.rng.uniform(0, 30), jj + sl[0].start, ii + sl[1].start))
    kand.sort(key=lambda q: q[0])
    S_all = np.zeros(x.shape, bool)
    przodki = []
    for _, jj, ii in kand[:int(M.rng.integers(4, 8))]:
        # odcinek: piksele pasma w promieniu L/2 od kotwicy (kotwica — piksel pasma bliżej środka)
        dc = np.sqrt(x[jj, ii] ** 2 + y[jj, ii] ** 2)
        a = int(M.rng.choice(np.argsort(dc)[:max(1, dc.size // 3)]))
        Ls = M.rng.uniform(50, 160)
        da = np.sqrt((x[jj, ii] - x[jj[a], ii[a]]) ** 2 + (y[jj, ii] - y[jj[a], ii[a]]) ** 2)
        wyb = da < Ls / 2
        S_all[jj[wyb], ii[wyb]] = True
        e = int(np.argmax(np.where(wyb, da, -1)))                 # przodek — koniec odcinka
        przodki.append((float(x[jj[e], ii[e]]), float(y[jj[e], ii[e]])))
    if not S_all.any():
        return
    dist = ndi.distance_transform_edt(~S_all, sampling=(M.px_km, dx_km)).astype(np.float32)
    szer_ = M.rng.uniform(7.0, 11.0)
    brzeg = (szum2(x, y, 1 / 5.0, ziarno * 31) - 0.5) * 2.5
    rowy = smoothstep(szer_ / 2 + 1.8, szer_ / 2 - 0.4, dist + brzeg)
    dno = smoothstep(szer_ * 0.3, szer_ * 0.08, dist)
    gruz = smoothstep(szer_ / 2 + 7.0, szer_ / 2 + 2.5, dist) * (1 - rowy) * smoothstep(0.35, 0.65, szum2(x, y, 1 / 6.0, ziarno * 31 + 9))
    plat = np.zeros(x.shape, np.float32)
    for k, (px, py) in enumerate(przodki):
        th = M.rng.uniform(0, math.pi)
        pu, pv = rot(x - px, y - py, th)
        plat = np.maximum(plat, pudelko(pu, pv, M.rng.uniform(4.5, 7.5), M.rng.uniform(3.5, 6.0), 0.5))
        lo2, la2 = M.lonlat(lon, lat, np.array([px]), np.array([py]))
        M.punkty(lo2, la2, M.rng.uniform(0.25, 0.5), 0.8, NOC['up_biel'])
        nk = int(M.rng.integers(2, 6))
        lo2, la2 = M.lonlat(lon, lat, px + M.rng.normal(0, 7.0, nk), py + M.rng.normal(0, 7.0, nk))
        M.punkty(lo2, la2, M.rng.uniform(0.04, 0.18, nk), 0.3, NOC['up_ziel'])
    sciana = mix(PAL['sciana'][None, None, :] * np.ones(x.shape + (1,), np.float32), PAL['swiezy'], smoothstep(0.3, 0.7, szum2(x, y, 1 / 3.0, ziarno)))
    M.mieszaj(rows, cols, PAL['gruz'], gruz * 0.45)
    M.mieszaj(rows, cols, sciana, rowy * 0.85)
    M.mieszaj(rows, cols, PAL['dno'], dno * 0.55)
    M.mieszaj(rows, cols, PAL['platforma'], plat * 0.9)
    M.wysokosc(rows, cols, -rowy * 700.0 - dno * 900.0 + gruz * 250.0 + plat * 250.0)
    # hub pola (platformy i lądowiska) przy najbliższym przodku, w bazie Unii Pasa większy z kopułami
    hx, hy = min(przodki, key=lambda p: p[0] ** 2 + p[1] ** 2)
    hx, hy = hx * 0.5 + M.rng.uniform(-20, 20), hy * 0.5 + M.rng.uniform(-20, 20)
    lo2, la2 = M.lonlat(lon, lat, np.array([hx]), np.array([hy]))
    hub_lo, hub_la = float(lo2[0]), float(la2[0])
    rows, cols, x, y = M.okno(hub_lo, hub_la, 45.0)
    hm = np.zeros(x.shape, np.float32)
    kop = np.zeros(x.shape, np.float32)
    th = M.rng.uniform(0, math.pi)
    for q in range(int(M.rng.integers(3, 6)) + (5 if baza else 0)):
        bx, by = M.rng.normal(0, 9 if baza else 6, 2)
        uu, vv = rot(x - bx, y - by, th + M.rng.uniform(-0.3, 0.3))
        hm = np.maximum(hm, pudelko(uu, vv, M.rng.uniform(4, 10), M.rng.uniform(3, 6), 0.5))
    if baza:
        for q in range(int(M.rng.integers(4, 8))):
            bx, by = M.rng.normal(0, 10, 2)
            kop = np.maximum(kop, smoothstep(M.rng.uniform(2.6, 5.0), 1.0, np.sqrt((x - bx) ** 2 + (y - by) ** 2)))
    M.mieszaj(rows, cols, PAL['platforma'], hm * 0.85)
    M.mieszaj(rows, cols, PAL['kopula'], kop * 0.8)
    M.wysokosc(rows, cols, hm * 300.0 + kop * 450.0)
    M.kropki(hub_lo, hub_la, x, y, hm + kop, 5.0 if baza else 3.0, (0.06, 0.32), 0.3, NOC['up_ziel'])
    M.kropki(hub_lo, hub_la, x, y, kop, 3.0, (0.08, 0.3), 0.35, NOC['up_biel'])
    ladowisko(M, hub_lo + M.rng.uniform(-0.8, 0.8), hub_la + M.rng.uniform(-0.8, 0.8), 8.0 if baza else 6.0,
              int(M.rng.integers(3, 6 if baza else 4)), PAL['kopula'], NOC['up_cyjan'], NOC['up_biel'], ziarno + 90, NOC['up_ziel'], skala=2.0)
    M.miejsca.append((hub_lo, hub_la, 'baza' if baza else 'hub'))


# ── GANIMEDES, KALLISTO: węzły Konsorcjum (depot, lądowiska) ─────────────────
def wezel_konsorcjum(M, miejsca, PAL):
    """Depot Konsorcjum: farma zbiorników, magazyny, pole lądowisk; pozostałe miejsca — samo pole lądowisk."""
    for k, (lo, la, glowny) in enumerate(miejsca):
        if glowny:
            farma_zbiornikow(M, lo, la, M.rng.uniform(11, 14), int(M.rng.integers(24, 40)), PAL['zbiornik'], NOC['sod'], k + 5, skala=2.0)
            rows, cols, x, y = M.okno(lo, la, 80.0)
            th = M.rng.uniform(0, math.pi)
            hm = np.zeros(x.shape, np.float32)
            for q in range(int(M.rng.integers(5, 9))):
                bx, by = 42.0 + M.rng.normal(0, 8), M.rng.normal(0, 10)
                uu, vv = rot(x - bx, y - by, th)
                hm = np.maximum(hm, pudelko(uu, vv, M.rng.uniform(6, 16), M.rng.uniform(4, 9), 0.6))
            M.mieszaj(rows, cols, PAL['magazyn'], hm * 0.85)
            M.wysokosc(rows, cols, hm * 350.0)
            M.kropki(lo, la, x, y, hm, 1.2, (0.05, 0.22), 0.3, NOC['sod'])
        lo2, la2 = M.lonlat(lo, la, np.array([-40.0 if glowny else 0.0]), np.array([22.0 if glowny else 0.0]))
        ladowisko(M, float(lo2[0]), float(la2[0]), 12.0 if glowny else 8.0, int(M.rng.integers(5, 9) if glowny else M.rng.integers(2, 5)),
                  PAL['plyta'], NOC['biel'], NOC['sod'], k + 30, NOC['fiolet'], skala=2.4)
        M.miejsca.append((lo, la, 'depot' if glowny else 'ladowisko'))
    drogi(M, [(a, b) for a, b, _ in M.miejsca[:2]], PAL['droga'], NOC['sod'], maks_km=900.0, skroty=0, gestosc_swiatel=0.05, szer=1.0, sila=0.3)


def ganimedes(W, H):
    M = Mapa('ganimedes', W, H, 71)
    v, w = wczytaj_szara('ganimedes', W, H)
    v = wypelnij(v, w, 9, M.px_km)
    vs = rozciagnij(v, 1.0, 99.5)
    lat = np.linspace(90 - 90 / H, -90 + 90 / H, H, dtype=np.float32)[:, None]
    # ciemne regiony (stary, kraterowany lód z pyłem) szarobrązowe, jasne pasma pręgowane szare z nutą błękitu,
    # czapy polarne szron, świeże kratery i promienie prawie białe
    PAL = {k: kolor(v_) for k, v_ in dict(
        ciemny='#5f5c58', jasny='#b6b6b4', szron='#d9dde2', promien='#e2e2df',
        zbiornik='#c8c6c0', magazyn='#4c4a47', plyta='#bab7af', droga='#7a746c',
    ).items()}
    tlo = rozmyj_kula(vs, max(1.0, 40.0 / M.px_km))
    kol = mix(PAL['ciemny'][None, None, :] * np.ones((H, W, 1), np.float32), PAL['jasny'], smoothstep(0.25, 0.65, tlo))
    kol = mix(kol, PAL['szron'], smoothstep(38, 62, np.abs(lat)) * smoothstep(0.4, 0.7, tlo) * 0.7)
    kol = mix(kol, PAL['promien'], smoothstep(0.75, 0.95, vs) * 0.5)
    kol = kol * detal(vs, M.px_km, 40.0, 0.55, 1.6)[..., None] ** 0.8
    M.kol = do_sredniej(kol, JASNOSC['ganimedes'], H, W)
    M.h = ((vs - rozmyj_kula(vs, max(1.0, 30.0 / M.px_km))) * 2200.0).astype(np.float32)
    M.log('mozaika + barwa')
    # Uruk Sulcus (jasne pasma pręgowane) — depot i port; pola lądowisk w ciemnym Galileo Regio i na południu
    wezel_konsorcjum(M, [(-163.0, 2.0, True), (-131.0, 24.0, False), (148.0, -12.0, False)], PAL)
    M.log('węzeł Konsorcjum')
    return M


def kallisto(W, H):
    M = Mapa('kallisto', W, H, 83)
    v, w = wczytaj_szara('kallisto', W, H)
    v = wypelnij(v, w, 11, M.px_km)
    vs = rozciagnij(v, 1.0, 99.7)
    # ciemna, stara, gęsto kraterowana powierzchnia (szarobrązowa), jasne kratery i baseny (lód)
    PAL = {k: kolor(v_) for k, v_ in dict(
        ciemny='#4c4a47', sredni='#787470', jasny='#cfccc6',
        zbiornik='#bdbab3', magazyn='#474441', plyta='#b2ada4', droga='#6a635b',
    ).items()}
    kol = mix(PAL['ciemny'][None, None, :] * np.ones((H, W, 1), np.float32), PAL['sredni'], smoothstep(0.15, 0.45, vs))
    kol = mix(kol, PAL['jasny'], smoothstep(0.42, 0.85, vs))
    kol = kol * detal(vs, M.px_km, 30.0, 0.55, 1.6)[..., None] ** 0.85
    M.kol = do_sredniej(kol, JASNOSC['kallisto'], H, W)
    M.h = ((vs - rozmyj_kula(vs, max(1.0, 30.0 / M.px_km))) * 2400.0).astype(np.float32)
    M.log('mozaika + barwa')
    # Valhalla (jasne centrum basenu) — depot; lądowiska w basenie Asgard i na równinach
    wezel_konsorcjum(M, [(-56.0, 15.0, True), (-140.0, 31.0, False), (40.0, -18.0, False)], PAL)
    M.log('węzeł Konsorcjum')
    return M


GENERATORY = dict(luna=luna, io=io, europa=europa, ganimedes=ganimedes, kallisto=kallisto)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cialo', default='wszystkie', help='luna | io | europa | ganimedes | kallisto | wszystkie')
    ap.add_argument('--szer', type=int, default=None, help='szerokość mapy (domyślnie: podgląd 2048, gra wg GRA_SZER)')
    ap.add_argument('--do-gry', action='store_true', help='zapis do public/assets/planety/solar/moons/')
    a = ap.parse_args()
    ciala = CIALA if a.cialo == 'wszystkie' else tuple(a.cialo.split(','))
    for c in ciala:
        W = a.szer or (GRA_SZER[c] if a.do_gry else 2048)
        H = W // 2
        wyj = os.path.join(KATALOG_REPO, 'public', 'assets', 'planety', 'solar', 'moons') if a.do_gry \
            else os.path.join(KATALOG_REPO, '.tmp', 'planety', f'ksiezyce-{W}')
        M = GENERATORY[c](W, H)
        zapisz(M, wyj, os.path.join(KATALOG_REPO, '.tmp', 'planety', f'podglad-ksiezyce-{W}'), PLIK[c])


if __name__ == '__main__':
    main()
