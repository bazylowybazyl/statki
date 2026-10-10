# -*- coding: utf-8 -*-
"""Generator map Merkurego — planety-kopalni (HULLFALL).

Rola w ekonomii gry (src/data/resources.js `PLANET_YIELD`, src/game/stationEconomy.js): najwyższe wydobycie
w układzie (żelazo, tytan, krzem, miedź), sama huta, „mała kolonia z ogromną kopalnią”, Merkury → Ziemia to
trzecia część tonażu układu. Na mapie: setki odkrywek w dnach kraterów i na równinach (rudne prowincje),
wielkie pola odkrywkowe na gładkich równinach, kilkanaście węzłów-hut z hałdami żużlu, wyrzutnie masy
i kotwice wyciągów orbitalnych na równiku, farmy słoneczne, lód w kraterach polarnych i GLOBALNA SIEĆ
tras (drzewo: od kopalń odnogi zbiegające się w magistrale do hut, huty połączone magistralami ze skrótami),
poprowadzonych po terenie (omijają ściany kraterów). Nocą: rozżarzone huty, przerywane łańcuchy świateł
tras, światła w odkrywkach, tory wyrzutni.

Wejście: MESSENGER USGS DEM Global 665 m v2 (NASA/USGS, domena publiczna) i dotychczasowa mapa koloru
(mozaika MESSENGER — detal gruntu). Wyjście: kolor, noc, normalne, maska połysku (farmy słoneczne).

  .tmp/venv-planety/Scripts/python -I scripts/planety/merkury.py --szer 2048            # podgląd
  .tmp/venv-planety/Scripts/python -I scripts/planety/merkury.py --szer 8192 --do-gry   # mapy gry

Dane: .tmp/planety-dane/merkury/dem.tif (Mercury_Messenger_USGS_DEM_Global_665m_v2.tif: int16 × 0,5 m,
równoodległa 23 040 × 11 520, kolumna 0 = 0° E, długość rośnie na wschód — jak MOLA, przesunięcie o W/2;
zgodność z mapą koloru sprawdzona korelacją rzeźby: szczyt przy W/2 − 0,13°, bez odbicia).
"""
import argparse
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
from wspolne import *  # noqa: E402,F401,F403
import infrastruktura as inf  # noqa: E402

R_MERKUREGO_KM = 2439.4
A_W, A_H = 2048, 1024        # siatka analizy: miejsca i sieć NIEZALEŻNE od szerokości wyjścia
T_W, T_H = 1024, 512         # siatka tras

P = dict(
    ziarno=23,
    przewyzszenie=1.8,
    huby=26,                 # węzły-huty (rudne prowincje)
    kopalnie=680,            # odkrywki
    wielkie=8,               # wielkie odkrywki w dnach dużych kraterów
    pola=22,                 # pola odkrywkowe na gładkich równinach
    wyrzutnie=7,
    wyciagi=3,
    lod=10,                  # kopalnie lodu w kraterach polarnych
)

PAL = {k: kolor(v) for k, v in dict(
    dno='#36383d', polka='#5d5f64', sciana='#46484d', halda='#9d9a94', halda_jasna='#b0ada6',
    zuzel='#2b2826', zuzel_rdza='#4a3a30', hala='#c2c1bc', hala_ciemna='#6e6f72', plac='#8f8e8a',
    panel='#262b36', rama='#363b46', tor='#36383b', lod='#d9e2e8', lod_brudny='#8f969b',
).items()}
NOC = {k: kolor(v) for k, v in dict(
    sod='#ffb35a', biel='#fff1d8', huta='#ff6a2a', zar='#ff3a10', tor='#bfe0ff', zimna='#d8e8ff',
).items()}


# ── Dane ───────────────────────────────────────────────────────────────────────
def wczytaj_dem(W, H):
    """Wysokość [m] (H, W), kolumna 0 = 180° W."""
    cache = os.path.join(KATALOG_DANYCH, 'merkury', f'dem_{W}_v2.npy')
    if os.path.exists(cache):
        return np.load(cache)
    import tifffile
    a = tifffile.memmap(os.path.join(KATALOG_DANYCH, 'merkury', 'dem.tif'))
    h2, w2 = a.shape[0] // 2, a.shape[1] // 2
    pol = np.empty((h2, w2), np.float32)                       # średnia 2 × 2 (pasami — plik ma 530 MB)
    for j0 in range(0, h2, 512):
        j1 = min(h2, j0 + 512)
        b = a[2 * j0:2 * j1].astype(np.float32)
        pol[j0:j1] = 0.25 * (b[0::2, 0::2] + b[1::2, 0::2] + b[0::2, 1::2] + b[1::2, 1::2])
    pol *= 0.5                                                  # SCALE = 0,5 m
    e = np.roll(przeskaluj(pol, W, H), W // 2, axis=1)          # 0° E → środek mapy
    # mozaika koloru leży 0,13° na zachód względem DEM (szczyt korelacji rzeźby: −0,75 px przy 2048)
    from scipy import ndimage as ndi
    e = ndi.shift(e, (0, -0.75 * W / 2048.0), order=1, mode='grid-wrap').astype(np.float32)
    np.save(cache, e)
    return e


# ── Plan: prowincje, węzły, kopalnie, pola (siatka analizy) ───────────────────────
def plan(rng, log):
    from scipy import ndimage as ndi
    from scipy.spatial import cKDTree
    R = R_MERKUREGO_KM
    e = wczytaj_dem(A_W, A_H)
    px = 2 * math.pi * R / A_W
    sl = inf.nachylenie(e, R)
    szer = np.linspace(90, -90, A_H, dtype=np.float32)[:, None] * np.ones((1, A_W), np.float32)
    img = wczytaj_obraz(os.path.join(KATALOG_REPO, 'public/assets/planety/solar/mercury/mercury_color.jpg'), A_W, A_H)
    L = luminancja(img)
    ciemne = smoothstep(1.05, 0.85, L / np.maximum(rozmyj_kula(L, 300.0 / px), 1e-3))      # materiał ciemny (LRM) — tytan
    zag = ndi.grey_closing(e, size=(13, 13), mode=('nearest', 'wrap')) - e                     # misy kraterów ~100 km
    zag_d = ndi.grey_closing(e[::2, ::2], size=(21, 21), mode=('nearest', 'wrap')) - e[::2, ::2]
    zag_d = przeskaluj(zag_d, A_W, A_H)                                                         # misy ~300 km
    sl_r = rozmyj_kula(sl, 40.0 / px)
    gladkie = smoothstep(0.035, 0.018, sl_r)                                                    # gładkie równiny
    dno = smoothstep(350, 900, zag) * smoothstep(0.08, 0.04, sl)
    ruda = pole_szumu(A_W, A_H, lambda x, y, z: fbm3(x, y, z, 2.1, 4, P['ziarno'] + 1))
    ruda = np.clip(0.75 * ruda + 0.25 * ciemne + 0.1 * gladkie, 0, 1)
    log('plan: pola analizy')

    def xyz(lon, lat):
        return kierunek_z_lonlat(lon, lat)

    # węzły-huty: szczyty rudnych prowincji, rozstawione po całej planecie
    wyn = rozmyj_kula(ruda, 250.0 / px) + 0.25 * rozmyj_kula(gladkie, 80.0 / px)
    wyn = wyn * (np.abs(szer) < 66)
    kand = np.argwhere(wyn[::4, ::4] > np.percentile(wyn[::4, ::4], 40)) * 4
    kol = np.argsort(-wyn[kand[:, 0], kand[:, 1]])
    huby = []
    for k in kol:
        j, i = kand[k]
        lon, lat = inf.piksel_do_lonlat(j, i, A_W, A_H)
        d = xyz(lon, lat)
        if any(np.dot(d, xyz(a, b)) > math.cos(math.radians(20.5)) for a, b, _ in huby):
            continue
        huby.append((lon, lat, 0.0))
        if len(huby) >= P['huby']:
            break
    # odsunięcie węzła na płaski teren w pobliżu (huta stoi na równinie, nie na ścianie krateru)
    for n, (lon, lat, _) in enumerate(huby):
        j, i = int((90 - lat) / 180 * A_H), int((lon + 180) / 360 * A_W) % A_W
        r = int(120 / px)
        jj = np.clip(np.arange(j - r, j + r + 1), 0, A_H - 1)
        ii = np.arange(i - r, i + r + 1) % A_W
        sub = sl_r[np.ix_(jj, ii)] + 0.0001 * ((jj[:, None] - j) ** 2 + (ii[None, :] - i) ** 2)
        a, b = np.unravel_index(np.argmin(sub), sub.shape)
        huby[n] = (*inf.piksel_do_lonlat(jj[a], ii[b], A_W, A_H), 0.0)
    log(f'plan: huby {len(huby)}')

    # odkrywki: losowanie ważone rudą (skupiska w prowincjach) i geologią (dna kraterów, równiny)
    w = smoothstep(0.35, 0.8, ruda) ** 1.2 * (0.12 + dno + 0.55 * gladkie) * (np.abs(szer) < 74) * (sl < 0.1)
    w += 0.008 * (np.abs(szer) < 72) * (sl < 0.08)                       # rozproszone pojedyncze kopalnie
    pw = (w[::2, ::2] * np.cos(np.radians(szer[::2, ::2]))).ravel()
    pw = pw / pw.sum()
    idx = rng.choice(pw.size, size=P['kopalnie'] * 6, replace=True, p=pw)
    zajete = [xyz(lo, la) for lo, la, _ in huby]
    zaj_r = [110.0] * len(huby)
    kopalnie = []
    for t in idx:
        j, i = divmod(int(t), A_W // 2)
        lon, lat = inf.piksel_do_lonlat(2 * j + rng.random() * 2, 2 * i + rng.random() * 2, A_W, A_H)
        r = float(np.clip(np.exp(rng.normal(math.log(13.0), 0.45)), 6.0, 42.0))
        d = xyz(lon, lat)
        if zajete:
            Z = np.array(zajete)
            ang = np.arccos(np.clip(Z @ d, -1, 1)) * R
            if np.any(ang < (np.array(zaj_r) + r) * 1.35 + 6):
                continue
        kopalnie.append((lon, lat, r, 0))
        zajete.append(d)
        zaj_r.append(r)
        if len(kopalnie) >= P['kopalnie']:
            break
    # wielkie odkrywki: dna dużych kraterów (misa ~300 km) w prowincjach
    wk = smoothstep(800, 2200, zag_d) * smoothstep(0.45, 0.7, ruda) * (np.abs(szer) < 65)
    kand = np.argwhere(wk[::3, ::3] > 0.3) * 3
    wielkie = 0
    for k in rng.permutation(len(kand)):
        j, i = kand[k]
        lon, lat = inf.piksel_do_lonlat(j, i, A_W, A_H)
        r = float(rng.uniform(55, 90))
        d = xyz(lon, lat)
        Z = np.array(zajete)
        ang = np.arccos(np.clip(Z @ d, -1, 1)) * R
        if np.any(ang < (np.array(zaj_r) + r) * 1.1 + 10):
            continue
        kopalnie.append((lon, lat, r, 1))
        zajete.append(d)
        zaj_r.append(r)
        wielkie += 1
        if wielkie >= P['wielkie']:
            break
    log(f'plan: odkrywki {len(kopalnie)} (wielkie {wielkie})')

    # pola odkrywkowe: gładkie równiny w prowincjach
    wp = smoothstep(0.55, 0.9, rozmyj_kula(gladkie, 60.0 / px)) * smoothstep(0.4, 0.65, ruda) * (np.abs(szer) < 70)
    kand = np.argwhere(wp[::3, ::3] > 0.4) * 3
    pola = []
    for k in rng.permutation(len(kand)):
        j, i = kand[k]
        lon, lat = inf.piksel_do_lonlat(j, i, A_W, A_H)
        Ld, Wd = float(rng.uniform(150, 420)), float(rng.uniform(50, 140))
        r = 0.5 * math.hypot(Ld, Wd)
        d = xyz(lon, lat)
        Z = np.array(zajete)
        ang = np.arccos(np.clip(Z @ d, -1, 1)) * R
        if np.any(ang < (np.array(zaj_r) * 0.6 + r) + 10):
            continue
        pola.append((lon, lat, Ld, Wd, float(rng.uniform(0, math.pi)), float(rng.uniform(0.3, 1.0))))
        zajete.append(d)
        zaj_r.append(r)
        if len(pola) >= P['pola']:
            break
    log(f'plan: pola odkrywkowe {len(pola)}')

    # lód: kratery polarne (zacienione dna)
    wl = smoothstep(400, 1200, zag) * (np.abs(szer) > 80.5) * (np.abs(szer) < 88.5)
    kand = np.argwhere(wl > 0.5)
    lod = []
    for k in rng.permutation(len(kand)):
        j, i = kand[k]
        lon, lat = inf.piksel_do_lonlat(j, i, A_W, A_H)
        d = xyz(lon, lat)
        if any(np.dot(d, xyz(a, b)) > math.cos(math.radians(4.5)) for a, b, _ in lod):
            continue
        lod.append((lon, lat, float(rng.uniform(5, 12))))
        if len(lod) >= P['lod']:
            break
    log(f'plan: lód {len(lod)}')

    # wyrzutnie masy i wyciągi orbitalne: węzły blisko równika
    blisko = sorted(range(len(huby)), key=lambda n: abs(huby[n][1]))
    wyrzutnie = []
    for n in blisko[:P['wyrzutnie']]:
        if abs(huby[n][1]) > 40:
            continue
        wyrzutnie.append((n, float(rng.uniform(-16, 16)) + (0.0 if rng.random() < 0.7 else 180.0), float(rng.uniform(380, 820))))
    # kotwice wyciągów: na równiku, na długości węzłów najbliższych równika, co najmniej 60° od siebie
    wyciagi = []
    for n in blisko:
        lon = huby[n][0] + float(rng.uniform(-3, 3))
        if all(abs(((lon - a + 180) % 360) - 180) > 60 for a, _ in wyciagi):
            wyciagi.append((lon, 0.0))
        if len(wyciagi) >= P['wyciagi']:
            break

    # rudny pył: przyciemnienie prowincji (gęstość kopalń, skala ~150 km)
    gest = np.zeros((A_H, A_W), np.float32)
    inf.punkty(gest, np.array([xyz(lo, la) for lo, la, r, _ in kopalnie]), A_W, A_H, np.array([r * r for _, _, r, _ in kopalnie], np.float32))
    gest = rozmyj_kula(gest, 110.0 / px)
    gest = np.clip(gest / np.percentile(gest[gest > 0], 97), 0, 1)
    return dict(e=e, sl=sl, gladkie=gladkie, huby=huby, kopalnie=kopalnie, pola=pola, lod=lod,
                wyrzutnie=wyrzutnie, wyciagi=wyciagi, gest=gest)


# ── Sieć tras (siatka tras) ─────────────────────────────────────────────────────
def siec_tras(pl, rng, log):
    from scipy.sparse.csgraph import dijkstra, minimum_spanning_tree
    R = R_MERKUREGO_KM
    sl = pl['sl']
    # nachylenie do siatki tras: maksimum 2 × 2 (ściana krateru nie znika przy uśrednieniu)
    s = np.maximum(np.maximum(sl[0::2, 0::2], sl[1::2, 0::2]), np.maximum(sl[0::2, 1::2], sl[1::2, 1::2]))
    szum = pole_szumu(T_W, T_H, lambda x, y, z: fbm3(x, y, z, 9.0, 3, P['ziarno'] + 7))
    koszt = (1.0 + np.clip((s / 0.045) ** 2 * 2.5, 0, 30)) * (0.8 + 0.4 * szum)
    lat = np.linspace(90, -90, T_H)[:, None] * np.ones((1, T_W))
    koszt = koszt * (1.0 + 4.0 * smoothstep(80, 87, np.abs(lat)))           # trasy omijają bieguny
    G = inf.graf_terenu(koszt.astype(np.float64), R)
    log('sieć: graf')

    # węzły sieci: huby + kotwice wyciągów (łączone magistralami)
    wezly = [(lo, la) for lo, la, _ in pl['huby']] + list(pl['wyciagi'])
    zr = [inf.komorka(lo, la, T_W, T_H) for lo, la in wezly]
    nh = len(pl['huby'])
    # magistrale: koszty między węzłami, drzewo rozpinające + skróty
    dist, pred = dijkstra(G, directed=False, indices=zr, return_predecessors=True)
    C = dist[:, zr]
    mst = minimum_spanning_tree(C).toarray()
    pary = set((min(a, b), max(a, b)) for a, b in zip(*np.nonzero(mst)))
    for a in range(nh):
        for b in np.argsort(C[a])[1:3]:
            b = int(b)
            if b < nh and (min(a, b), max(a, b)) not in pary and C[a, b] < 1.35 * np.sort(C[a])[1] + 400:
                pary.add((min(a, b), max(a, b)))
    for k in range(nh, len(wezly)):                                            # kotwica → najbliższy węzeł
        b = int(np.argmin(np.where(np.arange(len(wezly)) < nh, C[k], np.inf)))
        pary.add((min(k, b), max(k, b)))
    krawedzie = {}
    for a, b in pary:
        sc = inf.sciezka(pred[a], zr[b])
        for u, v in zip(sc[:-1], sc[1:]):
            k = (min(u, v), max(u, v))
            krawedzie[k] = max(krawedzie.get(k, 0.0), 1e9)                     # magistrala
    log(f'sieć: magistrale {len(pary)}')

    # odnogi: każda kopalnia (i pole, i lód) do huty, jazda po magistralach tańsza — drogi dojazdowe wpadają
    # w magistrale pod kątem ostrym ku hucie, sąsiednie kopalnie dzielą odnogę (drzewo przepływu)
    zrodla = [(lo, la, r * r) for lo, la, r, _ in pl['kopalnie']]
    zrodla += [(lo, la, 0.4 * Ld * Wd) for lo, la, Ld, Wd, _, _ in pl['pola']]
    zrodla += [(lo, la, 60.0) for lo, la, _ in pl['lod']]
    przeplyw = inf.odnogi_do_hub(G, set(krawedzie), zr[:nh], zrodla, T_W, T_H)
    for k, f in przeplyw.items():
        if k not in krawedzie:
            krawedzie[k] = f
    chains = inf.lancuchy(krawedzie)
    out = []
    for ch, fl in chains:
        Pp = inf.wezly_do_xyz(ch, T_W, T_H)
        klasa = 3 if fl >= 1e9 else (2 if fl > 2500 else (1 if fl > 400 else 0))
        Pp = inf.wygladz(inf.wygladz(Pp, 5), 3)
        out.append((Pp, klasa, fl))
    # stopnie węzłów siatki (skrzyżowania → składy)
    stop = {}
    for (a, b) in krawedzie:
        stop[a] = stop.get(a, 0) + 1
        stop[b] = stop.get(b, 0) + 1
    skrzyz = [n for n, s_ in stop.items() if s_ >= 3]
    log(f'sieć: łańcuchy {len(out)}, skrzyżowania {len(skrzyz)}')
    return out, inf.wezly_do_xyz(skrzyz, T_W, T_H) if skrzyz else np.zeros((0, 3))


# ── Rysowanie (siatka wyjścia) ─────────────────────────────────────────────────
def generuj(W, H, wyj, podglady, do_gry=False):
    t0 = time.time()
    rng = np.random.default_rng(P['ziarno'])
    log = lambda m: print(f'[{time.time() - t0:6.1f} s] {m}', flush=True)  # noqa: E731
    R = R_MERKUREGO_KM
    px_km = 2 * math.pi * R / W

    pl = plan(rng, log)
    siec, skrzyz = siec_tras(pl, rng, log)

    e = wczytaj_dem(W, H)
    kol = wczytaj_obraz(os.path.join(KATALOG_REPO, 'public/assets/planety/solar/mercury/mercury_color.jpg'), W, H)
    log('DEM i obraz')
    noc = np.zeros((H, W, 3), np.float32)
    wys = np.zeros((H, W), np.float32)
    sl_w = rozmyj_kula(inf.nachylenie(e, R), max(0.5, 4.0 / px_km))
    spec = np.zeros((H, W), np.float32)
    sw = inf.Swiatla(W, H, NOC, (2.2, 3.8, 7.5))

    # rudny pył w prowincjach: odsłonięty ciemny materiał rozwiewany przez wybuchy i ruch
    gest = przeskaluj(pl['gest'], W, H)
    plamy = pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, 26.0, 4, P['ziarno'] + 9))
    pyl = np.clip(gest * (0.55 + 0.9 * (plamy - 0.5)), 0, 1)
    kol = mix(kol, kol * np.array([0.66, 0.67, 0.70], np.float32), pyl * 0.8)
    del gest, plamy
    log('pył prowincji')

    # ── pola odkrywkowe: front robót (ciemny wkop) przesuwa się przez równinę, za nim wały nadkładu ──
    # (jasne, świeży urobek), przed nim nietknięty grunt. Obrys nieregularny (złoże, teren), front łukiem.
    for k, (lon, lat, Ld, Wd, th, postep) in enumerate(pl['pola']):
        rows, cols, x, y = inf.okno(lon, lat, 0.62 * math.hypot(Ld, Wd) + 25, W, H, R)
        u = x * math.cos(th) + y * math.sin(th)
        v = -x * math.sin(th) + y * math.cos(th)
        # obrys: superelipsa łamana szumem w dwóch skalach
        w1 = inf.szum2(x, y, 1.0 / (0.35 * Wd), k + 400) - 0.5
        w2 = inf.szum2(x, y, 1.0 / 9.0, k + 401) - 0.5
        ro = ((np.abs(u) / (Ld / 2)) ** 3 + (np.abs(v) / (Wd / 2)) ** 3) ** (1 / 3) * (1.0 - 0.5 * w1 - 0.12 * w2)
        wn = smoothstep(1.02, 0.95, ro)
        krzyw = float(rng.uniform(-1.0, 1.0)) * 0.6 / max(Wd, 1.0)            # front robót łukiem
        uu = u + krzyw * v * v
        uz = (uu + Ld / 2) / Ld
        okres = float(rng.uniform(9.0, 15.0))
        fala = uu + 2.5 * (inf.szum2(x, y, 1 / 22.0, k + 402) - 0.5) * okres
        pas = 0.5 + 0.5 * np.cos(2 * np.pi * fala / okres)
        za = wn * smoothstep(postep + 0.006, postep - 0.006, uz)                # obszar przekopany (wały nadkładu)
        wkop = wn * smoothstep(0.035, 0.0, np.abs(uz - postep + 0.02))          # czynny wkop: ciemny rów przy froncie
        gr = inf.szum2(x, y, 1 / 2.5, k + 403)
        sub = kol[np.ix_(rows, cols)]
        walki = mix(sub * 1.05, PAL['halda'][None, None, :] * (0.9 + 0.2 * gr[..., None]), smoothstep(0.35, 0.75, pas) * 0.55)
        walki = mix(walki, PAL['sciana'], smoothstep(0.25, 0.05, pas) * 0.35)
        b = mix(sub, walki, za * 0.85)
        b = mix(b, PAL['dno'][None, None, :] * (0.9 + 0.2 * gr[..., None]), wkop * 0.85)
        kol[np.ix_(rows, cols)] = b
        wys[np.ix_(rows, cols)] += (pas - 0.5) * 220.0 * za - 600.0 * wkop
        # front robót: łańcuch świateł (przerywany) i maszyny; rozsiane światła na zwałowisku
        gate = smoothstep(0.42, 0.58, inf.szum2(x, y, 1 / 6.0, k + 404))
        noc[np.ix_(rows, cols)] += NOC['sod'][None, None, :] * (wkop * gate * 0.9)[..., None]
        noc[np.ix_(rows, cols)] += NOC['sod'][None, None, :] * (za * smoothstep(0.95, 0.99, inf.szum2(x, y, 1 / 3.5, k + 405)) * 0.4)[..., None]
    log(f'pola odkrywkowe {len(pl["pola"])}')

    # ── sieć tras: pył i tor w dzień, przerywane łańcuchy świateł nocą ────────────
    SZER = {3: (15.0, 7.0), 2: (9.5, 4.2), 1: (5.5, 2.4), 0: (3.5, 1.4)}      # σ pasa pyłu, σ toru [km]
    for kl in (0, 1, 2, 3):
        m = np.zeros((H, W), np.float32)
        for Pp, k_, _ in siec:
            if k_ == kl:
                inf.polilinia(m, Pp, W, H, R)
        s_pyl, s_tor = SZER[kl]
        pas = inf.poszerz(m, s_pyl / px_km)
        kol = mix(kol, kol * np.array([1.22, 1.21, 1.21], np.float32), pas * (0.45 + 0.12 * kl))
        if s_tor > 0:
            tor = inf.poszerz(m, s_tor / px_km)
            kol = mix(kol, PAL['tor'], tor * (0.55 + 0.11 * kl))
            wys += tor * 25.0
        del m, pas
    log('trasy (dzień)')
    ODSTEP = {3: 7.0, 2: 10.0, 1: 14.0, 0: 20.0}
    JASN = {3: 1.0, 2: 0.85, 1: 0.6, 0: 0.4}
    PRZERWY = {3: 0.24, 2: 0.28, 1: 0.32, 0: 0.38}
    for n, (Pp, kl, fl) in enumerate(siec):
        Q, t = inf.probkuj(Pp, ODSTEP[kl], R)
        if len(Q) < 2:
            continue
        Q = Q[1:]
        t = t[1:]
        # przerwy: odcinki bez świateł (szum wzdłuż trasy), jasność rozproszona
        faza = rng.uniform(0, 100)
        przer = 0.5 + 0.5 * np.sin(t / rng.uniform(25, 60) + faza) * np.cos(t / rng.uniform(70, 160) + 2 * faza)
        ok = przer > PRZERWY[kl]
        wart = JASN[kl] * (0.4 + 0.6 * rng.random(len(Q)) ** 1.5) * ok
        biale = rng.random(len(Q)) < (0.18 if kl == 3 else 0.06)
        sw.dodaj(Q[~biale], wart[~biale].astype(np.float32), 'sod', 1 if kl == 3 else 0)
        sw.dodaj(Q[biale], wart[biale].astype(np.float32), 'biel', 1 if kl == 3 else 0)
    sw.dodaj(skrzyz, np.full(len(skrzyz), 0.7, np.float32), 'biel', 1)
    log('trasy (noc)')

    # ── odkrywki: tarasowe misy z ciemnym dnem (odsłonięty materiał tytanowy), hałdy ──
    # Wybuchy urabiające rozrzucają ciemny materiał z głębi wokół misy (jak naturalne kratery z ciemną
    # aureolą na Merkurym) — aureola z promienistymi smugami czyni kopalnię widoczną z orbity.
    for k, (lon, lat, r, wielka) in enumerate(pl['kopalnie']):
        rows, cols, x, y = inf.okno(lon, lat, r * 3.2, W, H, R)
        th = rng.uniform(0, math.pi)
        ex = rng.uniform(1.0, 1.45)
        u = x * math.cos(th) + y * math.sin(th)
        v = -x * math.sin(th) + y * math.cos(th)
        war = 0.8 + 0.4 * inf.szum2(x, y, 1.0 / (r * 0.7), k + 10)
        d = np.sqrt((u / ex) ** 2 + v ** 2) / (r * war)
        phi = np.arctan2(v, u)
        # aureola: ciemny rozrzut do ~2,8 r, promieniste smugi, nieregularny zasięg
        smugi = inf.szum2(np.cos(phi) * 3.0, np.sin(phi) * 3.0, 1.7, k + 15)
        zasieg = 1.9 + 1.1 * smugi + 0.4 * inf.szum2(x, y, 1.0 / r, k + 16)
        aur = smoothstep(zasieg, 1.0, d) * (d > 0.85) * (0.45 + 0.55 * smoothstep(0.35, 0.75, smugi))
        sub = kol[np.ix_(rows, cols)]
        kol[np.ix_(rows, cols)] = sub * (1.0 - (aur * 0.42)[..., None] * np.array([1.0, 0.98, 0.94], np.float32))
        m = smoothstep(1.0, 0.86, d)
        n_t = int(np.clip(r / 3.0, 2, 14))
        q = np.clip(1.0 - d, 0, 1) * n_t + 0.35 * (inf.szum2(x, y, 1.0 / max(3.0, r * 0.3), k + 11) - 0.5)
        fr = q - np.floor(q)
        sciana = smoothstep(0.7, 0.95, fr)
        b = mix(PAL['polka'][None, None, :] * np.ones(x.shape + (1,), np.float32), PAL['dno'], smoothstep(0.8, 0.2, d))
        b = mix(b, PAL['sciana'], sciana * 0.7) * (0.85 + 0.3 * inf.szum2(x, y, 1 / 3.0, k + 12)[..., None])
        # rampa transportowa: spirala od krawędzi do dna
        a0 = rng.uniform(0, 2 * math.pi)
        kat = (phi - a0 - 2 * math.pi * 0.8 * (1 - d)) % (2 * math.pi)
        rampa = smoothstep(0.12, 0.0, np.minimum(kat, 2 * math.pi - kat) * np.maximum(d, 0.2)) * (d < 0.95) * (d > 0.2)
        b = mix(b, PAL['halda_jasna'], rampa * 0.5)
        sub = kol[np.ix_(rows, cols)]
        kol[np.ix_(rows, cols)] = sub + (b - sub) * (m * 0.92)[..., None]
        glebok = (0.6 + 0.9 * wielka) * 35.0 * r
        wys[np.ix_(rows, cols)] -= np.floor(np.clip(1 - d, 0, 1) * n_t + 0.5) / n_t * glebok * m
        # hałdy: jedna – trzy, wydłużone wzdłuż obwodu, grudkowate, jasne (świeży urobek)
        for h_ in range(1 + int(rng.integers(0, 3))):
            ah = rng.uniform(0, 2 * math.pi)
            dh = r * rng.uniform(1.25, 1.65)
            rh = r * rng.uniform(0.4, 0.75)
            cx, cy = dh * math.cos(ah), dh * math.sin(ah)
            eu = (x - cx) * math.cos(ah + math.pi / 2) + (y - cy) * math.sin(ah + math.pi / 2)
            ev = -(x - cx) * math.sin(ah + math.pi / 2) + (y - cy) * math.cos(ah + math.pi / 2)
            gr = inf.szum2(x, y, 1.0 / max(2.0, rh * 0.5), k * 7 + h_ + 13)
            dm = np.sqrt((eu / 1.9) ** 2 + ev ** 2) / (rh * (0.8 + 0.4 * gr))
            mh = smoothstep(1.0, 0.7, dm) * (1 - m)
            sub = kol[np.ix_(rows, cols)]
            kol[np.ix_(rows, cols)] = sub + (PAL['halda'][None, None, :] * (0.9 + 0.25 * gr[..., None]) - sub) * (mh * 0.6)[..., None]
            wys[np.ix_(rows, cols)] += mh * (0.5 + gr) * 12.0 * r
        # noc: światła na krawędziach tarasów (przerywane), rampa, krawędź misy
        lan = smoothstep(0.92, 0.99, fr) * m * smoothstep(0.45, 0.65, inf.szum2(x, y, 1 / 3.0, k + 14))
        brzeg = smoothstep(0.08, 0.0, np.abs(d - 1.0)) * smoothstep(0.5, 0.65, inf.szum2(x, y, 1 / 2.5, k + 17))
        noc[np.ix_(rows, cols)] += NOC['sod'][None, None, :] * ((lan * (0.8 - 0.45 * wielka) + rampa * m * 0.25 + brzeg * 0.9) * (0.8 + 0.4 * wielka))[..., None]
        sw.dodaj(kierunek_z_lonlat(lon, lat)[None, :], np.array([min(1.0, 0.45 + 0.03 * r)], np.float32), 'sod', 1)
        sw.dodaj(inf.rozrzut(kierunek_z_lonlat(lon, lat), 3 + int(r / 6), r * 1.1, rng, R), np.full(3 + int(r / 6), 0.55, np.float32), 'sod', 0)
    log(f'odkrywki {len(pl["kopalnie"])}')

    # ── lód w kraterach polarnych ─────────────────────────────────────────────────
    for k, (lon, lat, r) in enumerate(pl['lod']):
        rows, cols, x, y = inf.okno(lon, lat, r * 2.2, W, H, R)
        d = np.sqrt(x * x + y * y) / (r * (0.8 + 0.4 * inf.szum2(x, y, 1 / 4.0, k + 500)))
        m = smoothstep(1.0, 0.7, d)
        pas = smoothstep(0.4, 0.6, inf.szum2(x * 0.3, y, 1 / 2.0, k + 501))
        b = mix(PAL['lod_brudny'][None, None, :] * np.ones(x.shape + (1,), np.float32), PAL['lod'], pas)
        sub = kol[np.ix_(rows, cols)]
        kol[np.ix_(rows, cols)] = sub + (b - sub) * (m * 0.8)[..., None]
        noc[np.ix_(rows, cols)] += NOC['zimna'][None, None, :] * (m * smoothstep(0.9, 0.98, inf.szum2(x, y, 1 / 2.0, k + 502)) * 0.6)[..., None]
        sw.dodaj(kierunek_z_lonlat(lon, lat)[None, :], np.array([0.6], np.float32), 'zimna', 1)
    log(f'lód {len(pl["lod"])}')

    # ── węzły-huty: hale, place, hałdy żużlu; farmy słoneczne wokół ──────────────
    for n, (lon, lat, _) in enumerate(pl['huby']):
        b = 0.25 + 0.75 * rng.random() ** 1.8                                  # kilka wielkich hut, reszta mniejsza
        r = 24.0 + 52.0 * b
        Q0 = kierunek_z_lonlat(lon, lat)
        # farmy słoneczne: pola bloków paneli w rzędach wschód–zachód (część bloków jeszcze nie stoi)
        for f in range(int(rng.integers(2, 5))):
            a = rng.uniform(0, 2 * math.pi)
            dd = rng.uniform(r * 1.7, r * 3.6)
            fl_lon = lon + math.degrees(dd * math.cos(a) / R / max(0.2, math.cos(math.radians(lat))))
            fl_lat = lat + math.degrees(dd * math.sin(a) / R)
            nu, nv = int(rng.integers(2, 6)), int(rng.integers(2, 5))
            bu, bv = rng.uniform(10, 18), rng.uniform(6, 12)
            gu, gv = rng.uniform(0.8, 1.8), rng.uniform(0.8, 1.8)
            Lu, Lv = nu * (bu + gu), nv * (bv + gv)
            rows, cols, x, y = inf.okno(fl_lon, fl_lat, 0.6 * math.hypot(Lu, Lv) + 6, W, H, R)
            th = rng.uniform(-0.12, 0.12)
            u = x * math.cos(th) + y * math.sin(th) + Lu / 2
            v = -x * math.sin(th) + y * math.cos(th) + Lv / 2
            iu, iv = np.floor(u / (bu + gu)), np.floor(v / (bv + gv))
            fu, fv = u - iu * (bu + gu), v - iv * (bv + gv)
            jest = inf.szum2(iu + 0.5, iv + 0.5, 0.97, n * 31 + f + 700) > 0.22
            mf = (smoothstep(-0.4, 0.4, fu) * smoothstep(bu + 0.4, bu - 0.4, fu) * smoothstep(-0.4, 0.4, fv) * smoothstep(bv + 0.4, bv - 0.4, fv)
                  * (iu >= 0) * (iu < nu) * (iv >= 0) * (iv < nv) * jest)
            mf = mf * smoothstep(0.09, 0.05, sl_w[np.ix_(rows, cols)])        # panele tylko na płaskim (nie na ścianach kraterów)
            rzad = smoothstep(0.86, 0.97, np.abs(np.cos(np.pi * fv / rng.uniform(2.4, 3.4))))
            pb = mix(PAL['panel'][None, None, :] * np.ones(x.shape + (1,), np.float32), PAL['rama'], rzad * 0.45)
            sub = kol[np.ix_(rows, cols)]
            kol[np.ix_(rows, cols)] = sub + (pb - sub) * (mf * 0.9)[..., None]
            spec[np.ix_(rows, cols)] = np.maximum(spec[np.ix_(rows, cols)], mf * (1 - rzad * 0.5) * 0.8)
            # nocą tylko światła przeszkodowe na narożnikach bloków
            rog = mf * smoothstep(0.6, 0.0, np.minimum(np.minimum(fu, bu - fu), np.minimum(fv, bv - fv))) * smoothstep(0.7, 0.85, inf.szum2(x, y, 1 / 1.5, n * 31 + f + 701))
            noc[np.ix_(rows, cols)] += NOC['zar'][None, None, :] * (rog * 0.5)[..., None]
        # huta
        rows, cols, x, y = inf.okno(lon, lat, r * 2.6, W, H, R)
        d = np.sqrt(x * x + y * y)
        war = inf.szum2(x, y, 1.0 / (r * 0.45), n + 600)
        mc = smoothstep(1.0, 0.75, d / (r * (0.55 + 0.6 * war)))
        th = rng.uniform(0, math.pi)
        u = x * math.cos(th) + y * math.sin(th)
        v = -x * math.sin(th) + y * math.cos(th)
        okr = rng.uniform(4.0, 6.5)
        blok = inf.szum2(np.floor(u / (okr * 1.7)), np.floor(v / okr), 0.71, n + 601)
        ulica = np.maximum(smoothstep(0.9, 0.98, np.abs(np.cos(np.pi * u / (okr * 1.7)))), smoothstep(0.9, 0.98, np.abs(np.cos(np.pi * v / okr))))
        zab = smoothstep(0.3, 0.45, blok) * (1 - ulica)
        hb = mix(PAL['plac'][None, None, :] * np.ones(x.shape + (1,), np.float32), PAL['hala'], zab * smoothstep(0.55, 0.75, blok))
        hb = mix(hb, PAL['hala_ciemna'], zab * smoothstep(0.55, 0.35, blok) * 0.8)
        sub = kol[np.ix_(rows, cols)]
        kol[np.ix_(rows, cols)] = sub + (hb - sub) * (mc * 0.9)[..., None]
        spec[np.ix_(rows, cols)] = np.maximum(spec[np.ix_(rows, cols)], mc * zab * 0.25)
        # hałdy żużlu: ciemne jęzory wylewane od huty
        strona = rng.uniform(0, 2 * math.pi)
        for z_ in range(int(rng.integers(3, 7))):
            a = strona + rng.normal(0, 0.75)
            dd = r * rng.uniform(0.8, 1.6)
            rz = r * rng.uniform(0.18, 0.5)
            cx, cy = dd * math.cos(a), dd * math.sin(a)
            ka = a + rng.uniform(-1.2, 1.2)
            eu = (x - cx) * math.cos(ka) + (y - cy) * math.sin(ka)
            ev = -(x - cx) * math.sin(ka) + (y - cy) * math.cos(ka)
            gr = inf.szum2(x, y, 1.0 / max(2.0, rz * 0.4), n * 11 + z_ + 602) * 0.6 + inf.szum2(x, y, 1.0 / max(1.0, rz * 0.15), n * 11 + z_ + 640) * 0.4
            dm = np.sqrt((eu / rng.uniform(1.2, 2.0)) ** 2 + ev ** 2) / (rz * (0.6 + 0.8 * gr))
            mz = smoothstep(1.0, 0.6, dm) * (1 - mc * 0.7)
            zb = mix(PAL['zuzel'][None, None, :] * np.ones(x.shape + (1,), np.float32), PAL['zuzel_rdza'], gr * 0.6)
            sub = kol[np.ix_(rows, cols)]
            kol[np.ix_(rows, cols)] = sub + (zb - sub) * (mz * 0.85)[..., None]
            spec[np.ix_(rows, cols)] = np.maximum(spec[np.ix_(rows, cols)], mz * 0.18)
            wys[np.ix_(rows, cols)] += mz * 300.0
            # świeży żużel żarzy się na czole jęzora
            czolo = smoothstep(0.8, 1.0, dm) * smoothstep(1.2, 1.0, dm) * smoothstep(0.0, 0.3, eu / rz) * smoothstep(0.5, 0.7, gr)
            noc[np.ix_(rows, cols)] += NOC['zar'][None, None, :] * (czolo * 0.7)[..., None]
        # noc: zabudowa (sód, biel), ulice, piece (żar) — kilka dużych plam w środku
        swiat = mc * zab * (0.3 + 0.7 * smoothstep(0.5, 0.9, blok))
        noc[np.ix_(rows, cols)] += NOC['sod'][None, None, :] * (swiat * 1.0 + mc * ulica * 0.6)[..., None]
        noc[np.ix_(rows, cols)] += NOC['biel'][None, None, :] * (mc * smoothstep(0.93, 0.99, inf.szum2(x, y, 1 / 1.6, n + 603)) * 0.8)[..., None]
        npc = int(6 + 10 * b)
        sw.dodaj(inf.rozrzut(Q0, npc, r * 0.55, rng, R), (0.7 + 0.3 * rng.random(npc)).astype(np.float32), 'huta', 2)
        nb_ = int(20 + 30 * b)
        sw.dodaj(inf.rozrzut(Q0, nb_, r * 0.9, rng, R), (0.6 + 0.4 * rng.random(nb_)).astype(np.float32), 'biel', 0)
        sw.dodaj(Q0[None, :], np.array([1.0], np.float32), 'huta', 2)
    log(f'huty {len(pl["huby"])}')

    # ── wyrzutnie masy: tory po wielkim kole od huty, nocą segmenty cewek ─────────
    for n, az, dl in pl['wyrzutnie']:
        lon, lat, _ = pl['huby'][n]
        c = kierunek_z_lonlat(lon, lat)
        e_ = np.array([-math.sin(math.radians(lon)), math.cos(math.radians(lon)), 0.0])
        n_ = np.cross(c, e_)
        dvec = math.cos(math.radians(az)) * e_ + math.sin(math.radians(az)) * n_
        t = np.linspace(40.0 / R, (40.0 + dl) / R, 400)
        Pp = np.cos(t)[:, None] * c[None, :] + np.sin(t)[:, None] * dvec[None, :]
        bok = np.cross(c, dvec)
        m = np.zeros((H, W), np.float32)
        for off in (-1.4, 1.4):
            Q = Pp + bok[None, :] * (off / R)
            inf.polilinia(m, Q / np.linalg.norm(Q, axis=1, keepdims=True), W, H, R)
        mp = np.zeros((H, W), np.float32)
        inf.polilinia(mp, Pp, W, H, R)
        pas = inf.poszerz(mp, 6.0 / px_km)
        kol = mix(kol, kol * 1.3, pas * 0.6)
        kol = mix(kol, PAL['tor'], inf.poszerz(m, 0.7 / px_km) * 0.85)
        wys += pas * 60.0
        Q, s = inf.probkuj(Pp, 4.5, R)
        u = s / max(s[-1], 1)
        seg = ((s / 4.5).astype(int) % 9) < 6                           # cewki w segmentach z przerwami
        sw.dodaj(Q, ((0.4 + 0.6 * u) * seg).astype(np.float32), 'tor', 1)
        sw.dodaj(Q[-1:], np.array([1.0], np.float32), 'tor', 2)
        del m, mp, pas
    log(f'wyrzutnie {len(pl["wyrzutnie"])}')

    # ── kotwice wyciągów orbitalnych na równiku ───────────────────────────────────
    for k, (lon, lat) in enumerate(pl['wyciagi']):
        rows, cols, x, y = inf.okno(lon, lat, 70.0, W, H, R)
        d = np.sqrt(x * x + y * y)
        phi = np.arctan2(y, x)
        szpr = smoothstep(2.0, 0.6, np.abs(((phi * 6 / (2 * np.pi) + 0.5) % 1.0) - 0.5) * 2 * np.pi / 6 * d) * smoothstep(60.0, 52.0, d) * (d > 22)
        pierscien = smoothstep(2.4, 0.4, np.abs(d - 22.0))
        plac = smoothstep(11.0, 9.5, d)
        b = kol[np.ix_(rows, cols)]
        b = mix(b, PAL['hala'], np.clip(pierscien + plac * 0.8, 0, 1) * 0.85)
        b = mix(b, PAL['tor'], szpr * 0.7)
        kol[np.ix_(rows, cols)] = b
        wys[np.ix_(rows, cols)] += pierscien * 150.0 + plac * 300.0
        Q0 = kierunek_z_lonlat(lon, lat)
        sw.dodaj(Q0[None, :], np.array([1.0], np.float32), 'biel', 2)
        ang = np.linspace(0, 2 * np.pi, 24, endpoint=False)
        t1 = np.array([-math.sin(math.radians(lon)), math.cos(math.radians(lon)), 0.0])
        t2 = np.cross(Q0, t1)
        Q = Q0[None, :] + (22.0 / R) * (np.cos(ang)[:, None] * t1[None, :] + np.sin(ang)[:, None] * t2[None, :])
        sw.dodaj(Q / np.linalg.norm(Q, axis=1, keepdims=True), np.full(24, 0.8, np.float32), 'zimna', 1)
    log(f'wyciągi {len(pl["wyciagi"])}')

    sw.wypiecz(noc, px_km)
    log('światła')

    # ── normalne ──────────────────────────────────────────────────────────────────
    h = e + wys
    nrm = normalne_z_wysokosci(h, R * 1000.0, P['przewyzszenie'])
    log('normalne')

    # ── zapis ─────────────────────────────────────────────────────────────────────
    kol_srgb = lin_do_srgb(kol)
    noc_srgb = lin_do_srgb(np.clip(noc, 0, 1))
    zapisz_rgb(os.path.join(wyj, 'mercury_hf_color.jpg'), kol_srgb, 92)
    zapisz_rgb(os.path.join(wyj, 'mercury_hf_night.jpg'), noc_srgb, 92)
    zapisz_normalne(os.path.join(wyj, 'mercury_hf_normal.jpg'), nrm, 95)
    zapisz_rgb(os.path.join(wyj, 'mercury_hf_spec.jpg'), przeskaluj(rozmyj_kula(spec, 0.7), W // 2, H // 2), 90)
    for nazwa, a in (('kolor', kol_srgb), ('noc', noc_srgb), ('normalne', nrm * 0.5 + 0.5)):
        podglad(os.path.join(podglady, f'merkury-{nazwa}.png'), a)
    log(f'zapis → {wyj}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--szer', type=int, default=2048)
    ap.add_argument('--do-gry', action='store_true', help='zapis do public/assets/planety/solar/mercury/')
    ap.add_argument('--wyj', default=None)
    a = ap.parse_args()
    W, H = a.szer, a.szer // 2
    wyj = os.path.join(KATALOG_REPO, 'public', 'assets', 'planety', 'solar', 'mercury') if a.do_gry else (a.wyj or os.path.join(KATALOG_REPO, '.tmp', 'planety', f'merkury-{W}'))
    generuj(W, H, wyj, os.path.join(KATALOG_REPO, '.tmp', 'planety', f'podglad-{W}'), a.do_gry)


if __name__ == '__main__':
    main()
