# -*- coding: utf-8 -*-
"""Generator map Wenus — planety fabryk (HULLFALL).

Rola w ekonomii gry (src/data/resources.js `PLANET_YIELD`, src/game/stationEconomy.js): miedź, krzem,
kryształ, trochę żelaza; huta, elektronika (układy scalone, optyka) i amunicjownia; więcej zakładów
i ludzi niż na Merkurym (moc 5,9 wobec 1,1), Konsorcjum Wewnętrzne.

Przemysł stoi NA POWIERZCHNI, na wyżynach: na Wenus wyżyny są chłodniejsze (~380 °C zamiast 460 °C
na nizinach) i mają rzadsze powietrze (~45 barów), a ich szczyty pokrywa „metaliczny szron” (jasne
w radarze siarczki metali, osiadające powyżej ~2,5–3 km) — tam kopie się miedź. Kryształ — w tesserach
(najstarszy, pofałdowany teren). Na płaskowyżach (Lakshmi Planum, grzbiety Afrodyty) duże jasne
kompleksy fabryk elektroniki i miasta, w dolinach przy wyżynach huty z hałdami żużlu, na nizinach
rozproszone zakłady amunicyjne (bunkry w wałach, odstępy bezpieczeństwa). Wszystko łączy sieć tras
(drzewo jak na Merkurym: odnogi do najbliższej magistrali albo węzła). Nocą — dużo świateł: miasta
i fabryki (zimna biel diod), huty (żar), łańcuchy tras, obwody zakładów amunicyjnych.

Chmury: dawna `venus_atmosphere.jpg` (pasma kwasu siarkowego) jako PÓŁPRZEZROCZYSTA warstwa z przerwami
(maska z jasności pasm, rozciągnięta) — na Wenus chmury kryją wszystko, w grze widać przez nie
powierzchnię; shader chmur gasi je nocą (alfa × oświetlenie), więc światła miast nie giną.

Wejście: Venus Magellan Global Topography 4641 m v2 (NASA/JPL/USGS, domena publiczna) i dotychczasowa
mapa koloru (venus_color.jpg — barwa z radaru Magellana; w pliku obrócona o 180° względem IAU: korelacja
rzeźby szczyt 0,42 po odbiciu obu osi — mapy gry są w układzie IAU, Ishtar na północy).

  .tmp/venv-planety/Scripts/python -I scripts/planety/wenus.py --szer 2048            # podgląd
  .tmp/venv-planety/Scripts/python -I scripts/planety/wenus.py --szer 8192 --do-gry   # mapy gry

Dane: .tmp/planety-dane/wenus/dem.tif (Venus_Magellan_Topography_Global_4641m_v02.tif: int16 m względem
6 051 km, 8192 × 4096, kolumna 0 = 180° W, długość na wschód; ~8% bez danych — wypełniane piramidą).
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

R_WENUS_KM = 6051.8
A_W, A_H = 2048, 1024        # siatka analizy: miejsca i sieć NIEZALEŻNE od szerokości wyjścia
T_W, T_H = 1024, 512         # siatka tras

P = dict(
    ziarno=31,
    przewyzszenie=2.6,
    huby=24,                 # węzły: fabryki elektroniki, huty, miasta
    kopalnie=420,            # kopalnie miedzi i krzemu (wyżyny, szron metaliczny)
    krysztaly=90,            # pola kryształu w tesserach
    amunicja=34,             # zakłady amunicyjne
    wyrzutnie=6,
)

PAL = {k: kolor(v) for k, v in dict(
    dno='#4a2810', polka='#7a4520', sciana='#5e3216', odpady='#d8ad6a', odpady_jasne='#e6c58a',
    zuzel='#2c1a10', zuzel_rdza='#4e2c18', dach='#f0e4c8', dach_ciemny='#a08868', plac='#c49a64',
    miasto='#b8a48a', krysztal='#f2e6cc', tor='#3e2412', wal='#e2b878', radiator='#e8dcc4',
).items()}
NOC = {k: kolor(v) for k, v in dict(
    sod='#ffb35a', biel='#fff1d8', led='#dfe9ff', huta='#ff6a2a', zar='#ff3a10', tor='#bfe0ff', alarm='#ff5030',
).items()}


# ── Dane ───────────────────────────────────────────────────────────────────────
def wypelnij_braki(a, brak):
    """Luki danych → średnia ważona z piramidy rozmyć (gładko, bez smug najbliższego sąsiada)."""
    from scipy.ndimage import gaussian_filter
    w = (~brak).astype(np.float32)
    v = np.where(brak, 0.0, a).astype(np.float32)
    out = v.copy()
    zostalo = brak.copy()
    s = 2.0
    while zostalo.any() and s < 600:
        num = gaussian_filter(v, s, mode=('nearest', 'wrap'))
        den = gaussian_filter(w, s, mode=('nearest', 'wrap'))
        ok = zostalo & (den > 0.02)
        out[ok] = num[ok] / den[ok]
        zostalo &= ~ok
        s *= 1.6
    # szew: miękkie przejście na brzegu luki
    from scipy.ndimage import distance_transform_edt
    d = distance_transform_edt(brak)
    t = np.clip(d / 6.0, 0, 1)
    gl = gaussian_filter(out, 3.0, mode=('nearest', 'wrap'))
    return np.where(brak, gl * t + out * (1 - t), out).astype(np.float32)


def wczytaj_dem(W, H):
    """Wysokość [m] (H, W) i maska luk, kolumna 0 = 180° W (jak plik)."""
    cache = os.path.join(KATALOG_DANYCH, 'wenus', f'dem_{W}.npz')
    if os.path.exists(cache):
        z = np.load(cache)
        return z['e'], z['brak']
    import tifffile
    a = tifffile.imread(os.path.join(KATALOG_DANYCH, 'wenus', 'dem.tif')).astype(np.float32)
    brak = a <= -32000
    a = wypelnij_braki(a, brak)
    if a.shape != (H, W):
        a = przeskaluj(a, W, H)
        brak = przeskaluj(brak.astype(np.float32), W, H, Image.BILINEAR) > 0.5
    np.savez(cache, e=a, brak=brak)
    return a, brak


def wczytaj_kolor(W, H):
    """venus_color.jpg obrócona o 180° (odbicie obu osi) do układu IAU."""
    img = wczytaj_obraz(os.path.join(KATALOG_REPO, 'public/assets/planety/solar/venus/venus_color.jpg'), W, H)
    return np.ascontiguousarray(img[::-1, ::-1])


# ── Plan (siatka analizy) ─────────────────────────────────────────────────────
def odstep_ok(zajete, zaj_r, d, r, k, R):
    if not zajete:
        return True
    Z = np.array(zajete)
    ang = np.arccos(np.clip(Z @ d, -1, 1)) * R
    return not np.any(ang < (np.array(zaj_r) + r) * k)


def plan(rng, log):
    from scipy import ndimage as ndi
    R = R_WENUS_KM
    e, _ = wczytaj_dem(A_W, A_H)
    px = 2 * math.pi * R / A_W
    sl = inf.nachylenie(e, R)
    sl_r = rozmyj_kula(sl, 60.0 / px)
    szer = np.linspace(90, -90, A_H, dtype=np.float32)[:, None] * np.ones((1, A_W), np.float32)
    wyzyny = smoothstep(1700, 3200, e)                                   # szron metaliczny, chłodniej
    szorstk = rozmyj_kula(np.abs(e - rozmyj_kula(e, 25.0 / px)), 40.0 / px)
    tessera = smoothstep(np.percentile(szorstk, 70), np.percentile(szorstk, 95), szorstk)
    plasko = smoothstep(0.03, 0.012, sl_r)
    ruda = pole_szumu(A_W, A_H, lambda x, y, z: fbm3(x, y, z, 1.8, 4, P['ziarno'] + 1))
    log('plan: pola analizy')

    xyz = kierunek_z_lonlat
    # węzły: płaskowyże wyżyn (fabryki, miasta) i płaskie podnóża wyżyn (huty — blisko rudy)
    wyz_r = rozmyj_kula(wyzyny, 250.0 / px)
    wyn = (0.9 * wyz_r * rozmyj_kula(plasko, 80.0 / px) + 0.35 * smoothstep(0.1, 0.5, wyz_r) * (1 - wyzyny) * plasko
           + 0.25 * rozmyj_kula(ruda, 300.0 / px)) * (np.abs(szer) < 72)
    kand = np.argwhere(wyn[::3, ::3] > np.percentile(wyn[::3, ::3], 35)) * 3
    kol = np.argsort(-wyn[kand[:, 0], kand[:, 1]] * (0.8 + 0.4 * rng.random(len(kand))))
    huby = []
    for k in kol:
        j, i = kand[k]
        lon, lat = inf.piksel_do_lonlat(j, i, A_W, A_H)
        d = xyz(lon, lat)
        if any(np.dot(d, xyz(a, b)) > math.cos(math.radians(19)) for a, b, _ in huby):
            continue
        huby.append((lon, lat, float(wyz_r[j, i] + 0.3 * wyzyny[j, i] + rng.normal(0, 0.08))))
        if len(huby) >= P['huby']:
            break
    # elektronika na płaskowyżach (chłodniej, rzadsze powietrze), huty na podnóżach: połowa najwyżej położonych
    prog = np.sort([h[2] for h in huby])[len(huby) // 2]
    huby = [(lo, la, 1.0 if v >= prog else 0.0) for lo, la, v in huby]
    log(f'plan: węzły {len(huby)} (elektronika {sum(1 for h in huby if h[2] > 0.5)})')

    zajete = [xyz(lo, la) for lo, la, _ in huby]
    zaj_r = [160.0] * len(huby)
    # kopalnie: szron metaliczny na wyżynach, rudne prowincje
    w = (0.15 + wyzyny) * smoothstep(0.3, 0.75, ruda) ** 1.3 * (np.abs(szer) < 76) * (sl < 0.12)
    w += 0.01 * (np.abs(szer) < 70) * (sl < 0.06)
    pw = (w[::2, ::2] * np.cos(np.radians(szer[::2, ::2]))).ravel()
    pw /= pw.sum()
    kopalnie = []
    for t in rng.choice(pw.size, size=P['kopalnie'] * 6, replace=True, p=pw):
        j, i = divmod(int(t), A_W // 2)
        lon, lat = inf.piksel_do_lonlat(2 * j + rng.random() * 2, 2 * i + rng.random() * 2, A_W, A_H)
        r = float(np.clip(np.exp(rng.normal(math.log(20.0), 0.45)), 10.0, 60.0))
        d = xyz(lon, lat)
        if not odstep_ok(zajete, zaj_r, d, r, 1.3, R):
            continue
        kopalnie.append((lon, lat, r, 0))
        zajete.append(d)
        zaj_r.append(r)
        if len(kopalnie) >= P['kopalnie']:
            break
    # kryształ: tessery
    w = tessera * smoothstep(0.3, 0.7, ruda) * (np.abs(szer) < 76)
    pw = (w[::2, ::2] * np.cos(np.radians(szer[::2, ::2]))).ravel() + 1e-9
    pw /= pw.sum()
    n_k = 0
    for t in rng.choice(pw.size, size=P['krysztaly'] * 8, replace=True, p=pw):
        j, i = divmod(int(t), A_W // 2)
        lon, lat = inf.piksel_do_lonlat(2 * j + rng.random() * 2, 2 * i + rng.random() * 2, A_W, A_H)
        r = float(rng.uniform(18, 45))
        d = xyz(lon, lat)
        if not odstep_ok(zajete, zaj_r, d, r, 1.2, R):
            continue
        kopalnie.append((lon, lat, r, 1))
        zajete.append(d)
        zaj_r.append(r)
        n_k += 1
        if n_k >= P['krysztaly']:
            break
    log(f'plan: kopalnie {len(kopalnie)} (kryształ {n_k})')

    # zakłady amunicyjne: płaskie niziny 150–700 km od węzłów (odstęp bezpieczeństwa)
    amunicja = []
    for k in rng.permutation(len(huby) * 40):
        n = k % len(huby)
        lon0, lat0, _ = huby[n]
        a = rng.uniform(0, 2 * math.pi)
        dd = rng.uniform(250, 750)
        lon = lon0 + math.degrees(dd * math.cos(a) / R / max(0.2, math.cos(math.radians(lat0))))
        lat = lat0 + math.degrees(dd * math.sin(a) / R)
        if abs(lat) > 70:
            continue
        j, i = int((90 - lat) / 180 * A_H), int(((lon + 180) % 360) / 360 * A_W) % A_W
        if wyzyny[j, i] > 0.3 or sl_r[j, i] > 0.02:
            continue
        r = float(rng.uniform(25, 45))
        d = xyz(lon, lat)
        if not odstep_ok(zajete, zaj_r, d, r, 1.4, R):
            continue
        amunicja.append((((lon + 180) % 360) - 180, lat, r))
        zajete.append(d)
        zaj_r.append(r)
        if len(amunicja) >= P['amunicja']:
            break
    log(f'plan: amunicja {len(amunicja)}')

    blisko = sorted(range(len(huby)), key=lambda n: abs(huby[n][1]))
    wyrzutnie = [(n, float(rng.uniform(-20, 20)) + (0.0 if rng.random() < 0.6 else 180.0), float(rng.uniform(450, 1000)))
                 for n in blisko[:P['wyrzutnie']] if abs(huby[n][1]) < 45 and huby[n][2] > 0.3]
    return dict(e=e, sl=sl, huby=huby, kopalnie=kopalnie, amunicja=amunicja, wyrzutnie=wyrzutnie)


def siec_tras(pl, log):
    from scipy.sparse.csgraph import dijkstra, minimum_spanning_tree
    R = R_WENUS_KM
    sl = pl['sl']
    s = np.maximum(np.maximum(sl[0::2, 0::2], sl[1::2, 0::2]), np.maximum(sl[0::2, 1::2], sl[1::2, 1::2]))
    szum = pole_szumu(T_W, T_H, lambda x, y, z: fbm3(x, y, z, 9.0, 4, P['ziarno'] + 7))
    koszt = (1.0 + np.clip((s / 0.035) ** 2 * 2.5, 0, 30)) * (0.6 + 0.8 * szum)
    lat = np.linspace(90, -90, T_H)[:, None] * np.ones((1, T_W))
    koszt = koszt * (1.0 + 4.0 * smoothstep(78, 86, np.abs(lat)))
    G = inf.graf_terenu(koszt.astype(np.float64), R)
    log('sieć: graf')
    nh = len(pl['huby'])
    zr = [inf.komorka(lo, la, T_W, T_H) for lo, la, _ in pl['huby']]
    dist, pred = dijkstra(G, directed=False, indices=zr, return_predecessors=True)
    C = dist[:, zr]
    mst = minimum_spanning_tree(C).toarray()
    pary = set((min(a, b), max(a, b)) for a, b in zip(*np.nonzero(mst)))
    for a in range(nh):
        for b in np.argsort(C[a])[1:3]:
            b = int(b)
            if (min(a, b), max(a, b)) not in pary and C[a, b] < 1.35 * np.sort(C[a])[1] + 600:
                pary.add((min(a, b), max(a, b)))
    krawedzie = {}
    for a, b in pary:
        sc = inf.sciezka(pred[a], zr[b])
        for u, v in zip(sc[:-1], sc[1:]):
            krawedzie[(min(u, v), max(u, v))] = 1e9
    log(f'sieć: magistrale {len(pary)}')
    # odnogi: każda kopalnia do huty, jazda po magistralach tańsza — drogi dojazdowe wpadają w magistrale
    # pod kątem ostrym ku hucie, sąsiednie kopalnie dzielą odnogę (drzewo przepływu)
    zrodla = [(lo, la, r * r) for lo, la, r, _ in pl['kopalnie']] + [(lo, la, r * r) for lo, la, r in pl['amunicja']]
    przeplyw = inf.odnogi_do_hub(G, set(krawedzie), zr, zrodla, T_W, T_H)
    for k, f in przeplyw.items():
        if k not in krawedzie:
            krawedzie[k] = f
    out = []
    for ch, fl in inf.lancuchy(krawedzie):
        Pp = inf.wygladz(inf.wygladz(inf.wezly_do_xyz(ch, T_W, T_H), 5), 3)
        out.append((Pp, 3 if fl >= 1e9 else (2 if fl > 6000 else (1 if fl > 1200 else 0)), fl))
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
    R = R_WENUS_KM
    px_km = 2 * math.pi * R / W

    pl = plan(rng, log)
    siec, skrzyz = siec_tras(pl, log)

    e, brak = wczytaj_dem(W, H)
    kol = wczytaj_kolor(W, H)
    log('DEM i obraz')
    noc = np.zeros((H, W, 3), np.float32)
    wys = np.zeros((H, W), np.float32)
    spec = np.zeros((H, W), np.float32)
    sw = inf.Swiatla(W, H, NOC, (3.0, 5.5, 11.0))
    sl_w = rozmyj_kula(inf.nachylenie(e, R), max(0.5, 6.0 / px_km))

    # ── zakłady amunicyjne: bunkry w wałach, rozstawione rzędami z odstępami ──────
    for k, (lon, lat, r) in enumerate(pl['amunicja']):
        rows, cols, x, y = inf.okno(lon, lat, r * 1.5, W, H, R)
        th = rng.uniform(0, math.pi)
        u = x * math.cos(th) + y * math.sin(th)
        v = -x * math.sin(th) + y * math.cos(th)
        okr = rng.uniform(6.0, 9.0)
        iu, iv = np.floor(u / okr), np.floor(v / okr)
        fu, fv = u - (iu + 0.5) * okr, v - (iv + 0.5) * okr
        jest = (inf.szum2(iu + 0.5, iv + 0.5, 0.93, k + 900) > 0.35) * smoothstep(r, r * 0.75, np.sqrt(x * x + y * y) * (0.8 + 0.4 * inf.szum2(x, y, 1 / 20.0, k + 901)))
        dc = np.maximum(np.abs(fu), np.abs(fv))
        wal = smoothstep(okr * 0.36, okr * 0.3, dc) * smoothstep(okr * 0.16, okr * 0.24, dc) * jest
        bunkier = smoothstep(okr * 0.14, okr * 0.08, dc) * jest
        sub = kol[np.ix_(rows, cols)]
        b = mix(sub, PAL['wal'][None, None, :] * np.ones_like(sub), wal * 0.75)
        b = mix(b, PAL['dach_ciemny'][None, None, :] * np.ones_like(sub), bunkier * 0.85)
        dr = smoothstep(0.9, 0.97, np.abs(np.cos(np.pi * u / okr))) * smoothstep(r, r * 0.8, np.sqrt(x * x + y * y)) * (1 - wal)
        b = mix(b, PAL['tor'][None, None, :] * np.ones_like(sub), dr * 0.35)
        kol[np.ix_(rows, cols)] = b
        wys[np.ix_(rows, cols)] += wal * 120.0
        # noc: światła na wałach (obwody), rzadkie — zakłady są nocą ciemne
        obw = wal * smoothstep(0.6, 0.8, inf.szum2(x, y, 1 / 2.0, k + 902))
        noc[np.ix_(rows, cols)] += NOC['alarm'][None, None, :] * (obw * 0.8)[..., None] + NOC['biel'][None, None, :] * (bunkier * 0.25)[..., None]
    log(f'amunicja {len(pl["amunicja"])}')

    # ── sieć tras ────────────────────────────────────────────────────────────────
    SZER = {3: (22.0, 8.0), 2: (14.0, 5.0), 1: (9.0, 3.0), 0: (6.0, 2.0)}
    for kl in (0, 1, 2, 3):
        m = np.zeros((H, W), np.float32)
        for Pp, k_, _ in siec:
            if k_ == kl:
                inf.polilinia(m, Pp, W, H, R)
        s_pyl, s_tor = SZER[kl]
        pas = inf.poszerz(m, s_pyl / px_km)
        kol = mix(kol, kol * np.array([1.18, 1.16, 1.12], np.float32), pas * (0.4 + 0.1 * kl))
        tor = inf.poszerz(m, s_tor / px_km)
        kol = mix(kol, PAL['tor'], tor * (0.5 + 0.1 * kl))
        wys += tor * 40.0
        del m, pas, tor
    log('trasy (dzień)')
    ODSTEP = {3: 8.0, 2: 11.0, 1: 14.0, 0: 19.0}
    JASN = {3: 1.0, 2: 0.9, 1: 0.75, 0: 0.55}
    PRZERWY = {3: 0.22, 2: 0.26, 1: 0.3, 0: 0.36}
    for Pp, kl, fl in siec:
        Q, t = inf.probkuj(Pp, ODSTEP[kl], R)
        if len(Q) < 2:
            continue
        Q, t = Q[1:], t[1:]
        faza = rng.uniform(0, 100)
        przer = 0.5 + 0.5 * np.sin(t / rng.uniform(30, 70) + faza) * np.cos(t / rng.uniform(80, 180) + 2 * faza)
        wart = (JASN[kl] * (0.4 + 0.6 * rng.random(len(Q)) ** 1.5) * (przer > PRZERWY[kl])).astype(np.float32)
        biale = rng.random(len(Q)) < (0.25 if kl == 3 else 0.08)
        sw.dodaj(Q[~biale], wart[~biale], 'sod', 1 if kl == 3 else 0)
        sw.dodaj(Q[biale], wart[biale], 'biel', 1 if kl == 3 else 0)
    sw.dodaj(skrzyz, np.full(len(skrzyz), 0.7, np.float32), 'biel', 1)
    log('trasy (noc)')

    # ── kopalnie: miedź / krzem (misy z tarasami) i kryształ (rowy w tesserach) ──
    for k, (lon, lat, r, krysz) in enumerate(pl['kopalnie']):
        rows, cols, x, y = inf.okno(lon, lat, r * 2.6, W, H, R)
        th = rng.uniform(0, math.pi)
        u = x * math.cos(th) + y * math.sin(th)
        v = -x * math.sin(th) + y * math.cos(th)
        if krysz:
            # pole kryształu: kilka równoległych rowów wzdłuż grzbietów tessery, jasne szkliste odpady
            n_r = int(rng.integers(3, 7))
            okres = r * 2.0 / n_r
            war = inf.szum2(x, y, 1.0 / (r * 0.6), k + 30)
            rr = smoothstep(r, r * 0.7, np.sqrt((u / 1.2) ** 2 + (v / 0.8) ** 2) * (0.8 + 0.4 * war))
            rowy = smoothstep(0.75, 0.95, np.abs(np.cos(np.pi * (v + 0.25 * okres * (war - 0.5)) / okres))) * rr
            odp = smoothstep(0.3, 0.1, np.abs(np.cos(np.pi * (v + 0.25 * okres * (war - 0.5)) / okres))) * rr
            gr = inf.szum2(x, y, 1 / 2.5, k + 31)
            sub = kol[np.ix_(rows, cols)]
            b = mix(sub, PAL['krysztal'][None, None, :] * (0.85 + 0.25 * gr[..., None]), odp * 0.7)
            b = mix(b, PAL['dno'][None, None, :] * np.ones_like(sub), rowy * 0.85)
            kol[np.ix_(rows, cols)] = b
            spec[np.ix_(rows, cols)] = np.maximum(spec[np.ix_(rows, cols)], odp * smoothstep(0.5, 0.8, gr) * 0.9)
            wys[np.ix_(rows, cols)] -= rowy * 500.0
            noc[np.ix_(rows, cols)] += NOC['led'][None, None, :] * (rowy * smoothstep(0.55, 0.7, inf.szum2(x, y, 1 / 3.0, k + 32)) * 0.7)[..., None]
            sw.dodaj(kierunek_z_lonlat(lon, lat)[None, :], np.array([0.6], np.float32), 'led', 1)
            continue
        ex = rng.uniform(1.0, 1.45)
        war = 0.8 + 0.4 * inf.szum2(x, y, 1.0 / (r * 0.7), k + 10)
        d = np.sqrt((u / ex) ** 2 + v ** 2) / (r * war)
        phi = np.arctan2(v, u)
        m = smoothstep(1.0, 0.86, d)
        n_t = int(np.clip(r / 4.5, 2, 12))
        q = np.clip(1.0 - d, 0, 1) * n_t + 0.35 * (inf.szum2(x, y, 1.0 / max(4.0, r * 0.3), k + 11) - 0.5)
        fr = q - np.floor(q)
        b = mix(PAL['polka'][None, None, :] * np.ones(x.shape + (1,), np.float32), PAL['dno'], smoothstep(0.8, 0.2, d))
        b = mix(b, PAL['sciana'], smoothstep(0.7, 0.95, fr) * 0.6) * (0.85 + 0.3 * inf.szum2(x, y, 1 / 4.0, k + 12)[..., None])
        sub = kol[np.ix_(rows, cols)]
        kol[np.ix_(rows, cols)] = sub + (b - sub) * (m * 0.9)[..., None]
        wys[np.ix_(rows, cols)] -= np.floor(np.clip(1 - d, 0, 1) * n_t + 0.5) / n_t * 30.0 * r * m
        # odpady flotacji: jasne jęzory po jednej stronie
        for h_ in range(1 + int(rng.integers(0, 2))):
            ah = rng.uniform(0, 2 * math.pi)
            dh, rh = r * rng.uniform(1.3, 1.7), r * rng.uniform(0.45, 0.8)
            cx, cy = dh * math.cos(ah), dh * math.sin(ah)
            eu = (x - cx) * math.cos(ah) + (y - cy) * math.sin(ah)
            ev = -(x - cx) * math.sin(ah) + (y - cy) * math.cos(ah)
            gr = inf.szum2(x, y, 1.0 / max(3.0, rh * 0.5), k * 7 + h_ + 13)
            mh = smoothstep(1.0, 0.7, np.sqrt((eu / 1.7) ** 2 + ev ** 2) / (rh * (0.75 + 0.5 * gr))) * (1 - m)
            sub = kol[np.ix_(rows, cols)]
            kol[np.ix_(rows, cols)] = sub + (PAL['odpady'][None, None, :] * (0.85 + 0.25 * gr[..., None]) - sub) * (mh * 0.65)[..., None]
            wys[np.ix_(rows, cols)] += mh * gr * 10.0 * r
        brzeg = smoothstep(0.07, 0.0, np.abs(d - 1.0)) * smoothstep(0.5, 0.65, inf.szum2(x, y, 1 / 3.5, k + 17))
        lan = smoothstep(0.92, 0.99, fr) * m * smoothstep(0.5, 0.7, inf.szum2(x, y, 1 / 4.0, k + 14))
        noc[np.ix_(rows, cols)] += NOC['sod'][None, None, :] * (brzeg * 0.85 + lan * 0.5)[..., None]
        sw.dodaj(kierunek_z_lonlat(lon, lat)[None, :], np.array([min(1.0, 0.4 + 0.02 * r)], np.float32), 'sod', 1)
    log(f'kopalnie {len(pl["kopalnie"])}')

    # ── węzły: fabryki elektroniki i miasta (płaskowyże), huty (podnóża) ──────────
    for n, (lon, lat, el) in enumerate(pl['huby']):
        b = 0.3 + 0.7 * rng.random() ** 1.5
        r = (60.0 + 90.0 * b) if el > 0.5 else (40.0 + 60.0 * b)
        Q0 = kierunek_z_lonlat(lon, lat)
        rows, cols, x, y = inf.okno(lon, lat, r * 2.4, W, H, R)
        d = np.sqrt(x * x + y * y)
        war = inf.szum2(x, y, 1.0 / (r * 0.45), n + 600)
        mc = smoothstep(1.0, 0.75, d / (r * (0.55 + 0.6 * war))) * smoothstep(0.1, 0.05, sl_w[np.ix_(rows, cols)])
        th = rng.uniform(0, math.pi)
        u = x * math.cos(th) + y * math.sin(th)
        v = -x * math.sin(th) + y * math.cos(th)
        sub = kol[np.ix_(rows, cols)]
        if el > 0.5:
            # fabryki elektroniki: długie hale o jasnych płaskich dachach w kwartałach, pola radiatorów
            okr = rng.uniform(7.0, 11.0)
            iu, iv = np.floor(u / (okr * 2.2)), np.floor(v / okr)
            blok = inf.szum2(iu, iv, 0.71, n + 601)
            fu, fv = u - iu * okr * 2.2, v - iv * okr
            hala = smoothstep(0.6, 1.2, fu) * smoothstep(okr * 2.2 - 0.6, okr * 2.2 - 1.2, fu) * smoothstep(0.6, 1.2, fv) * smoothstep(okr - 0.6, okr - 1.2, fv)
            zab = smoothstep(0.32, 0.45, blok) * hala
            radiator = smoothstep(0.12, 0.25, blok) * smoothstep(0.32, 0.25, blok) * hala * smoothstep(0.6, 0.9, np.abs(np.cos(np.pi * fv / 1.4)))
            hb = mix(PAL['plac'][None, None, :] * np.ones(x.shape + (1,), np.float32), PAL['dach'], zab * (0.75 + 0.25 * smoothstep(0.5, 0.8, blok)))
            hb = mix(hb, PAL['radiator'], radiator * 0.8)
            kol[np.ix_(rows, cols)] = sub + (hb - sub) * (mc * 0.9)[..., None]
            spec[np.ix_(rows, cols)] = np.maximum(spec[np.ix_(rows, cols)], mc * (zab * 0.35 + radiator * 0.6))
            # miasto obok (mieszkańcy): drobniejsza zabudowa szarozłota wokół fabryk
            dm = d / (r * (1.3 + 0.5 * war))
            mm = smoothstep(1.0, 0.6, dm) * (1 - mc) * smoothstep(0.35, 0.55, inf.szum2(x, y, 1 / 14.0, n + 605)) * smoothstep(0.1, 0.05, sl_w[np.ix_(rows, cols)])
            gr = inf.szum2(np.floor(u / 3.0), np.floor(v / 3.0), 0.77, n + 606)
            sub = kol[np.ix_(rows, cols)]
            kol[np.ix_(rows, cols)] = sub + (PAL['miasto'][None, None, :] * (0.75 + 0.4 * gr[..., None]) - sub) * (mm * 0.55)[..., None]
            noc[np.ix_(rows, cols)] += NOC['led'][None, None, :] * (mc * (zab * 0.9 + 0.25))[..., None]
            noc[np.ix_(rows, cols)] += NOC['biel'][None, None, :] * (mm * (0.25 + 0.75 * smoothstep(0.4, 0.9, gr)) * 0.75)[..., None]
            nb_ = int(70 + 90 * b)
            sw.dodaj(inf.rozrzut(Q0, nb_, r * 2.0, rng, R), (0.45 + 0.55 * rng.random(nb_)).astype(np.float32), 'biel', 0)
            sw.dodaj(inf.rozrzut(Q0, nb_ // 2, r * 2.6, rng, R), (0.35 + 0.5 * rng.random(nb_ // 2)).astype(np.float32), 'sod', 0)
            sw.dodaj(Q0[None, :], np.array([1.0], np.float32), 'led', 2)
            wys[np.ix_(rows, cols)] += mc * zab * 60.0
        else:
            # huta: hale, place, hałdy żużlu po stronie zwałowiska, żar
            okr = rng.uniform(5.0, 8.0)
            blok = inf.szum2(np.floor(u / (okr * 1.7)), np.floor(v / okr), 0.71, n + 601)
            zab = smoothstep(0.3, 0.45, blok)
            hb = mix(PAL['plac'][None, None, :] * np.ones(x.shape + (1,), np.float32), PAL['dach_ciemny'], zab * 0.8)
            kol[np.ix_(rows, cols)] = sub + (hb - sub) * (mc * 0.88)[..., None]
            strona = rng.uniform(0, 2 * math.pi)
            for z_ in range(int(rng.integers(3, 7))):
                a = strona + rng.normal(0, 0.75)
                dd = r * rng.uniform(0.8, 1.6)
                rz = r * rng.uniform(0.18, 0.5)
                cx, cy = dd * math.cos(a), dd * math.sin(a)
                ka = a + rng.uniform(-1.2, 1.2)
                eu = (x - cx) * math.cos(ka) + (y - cy) * math.sin(ka)
                ev = -(x - cx) * math.sin(ka) + (y - cy) * math.cos(ka)
                gr = inf.szum2(x, y, 1.0 / max(3.0, rz * 0.4), n * 11 + z_ + 602) * 0.6 + inf.szum2(x, y, 1.0 / max(1.5, rz * 0.15), n * 11 + z_ + 640) * 0.4
                dm = np.sqrt((eu / rng.uniform(1.2, 2.0)) ** 2 + ev ** 2) / (rz * (0.6 + 0.8 * gr))
                mz = smoothstep(1.0, 0.6, dm) * (1 - mc * 0.7)
                zb = mix(PAL['zuzel'][None, None, :] * np.ones(x.shape + (1,), np.float32), PAL['zuzel_rdza'], gr * 0.6)
                sub = kol[np.ix_(rows, cols)]
                kol[np.ix_(rows, cols)] = sub + (zb - sub) * (mz * 0.85)[..., None]
                wys[np.ix_(rows, cols)] += mz * 300.0
                czolo = smoothstep(0.8, 1.0, dm) * smoothstep(1.2, 1.0, dm) * smoothstep(0.5, 0.7, gr)
                noc[np.ix_(rows, cols)] += NOC['zar'][None, None, :] * (czolo * 0.7)[..., None]
            noc[np.ix_(rows, cols)] += NOC['sod'][None, None, :] * (mc * zab * (0.3 + 0.7 * smoothstep(0.5, 0.9, blok)))[..., None]
            npc = int(6 + 10 * b)
            sw.dodaj(inf.rozrzut(Q0, npc, r * 0.55, rng, R), (0.7 + 0.3 * rng.random(npc)).astype(np.float32), 'huta', 2)
            nb_ = int(15 + 20 * b)
            sw.dodaj(inf.rozrzut(Q0, nb_, r * 0.9, rng, R), (0.5 + 0.4 * rng.random(nb_)).astype(np.float32), 'biel', 0)
    log(f'węzły {len(pl["huby"])}')

    # ── wyrzutnie masy (ładunek elektroniki i amunicji na orbitę) ─────────────────
    for n, az, dl in pl['wyrzutnie']:
        lon, lat, _ = pl['huby'][n]
        c = kierunek_z_lonlat(lon, lat)
        e_ = np.array([-math.sin(math.radians(lon)), math.cos(math.radians(lon)), 0.0])
        n_ = np.cross(c, e_)
        dvec = math.cos(math.radians(az)) * e_ + math.sin(math.radians(az)) * n_
        t = np.linspace(110.0 / R, (110.0 + dl) / R, 500)
        Pp = np.cos(t)[:, None] * c[None, :] + np.sin(t)[:, None] * dvec[None, :]
        bok = np.cross(c, dvec)
        m = np.zeros((H, W), np.float32)
        for off in (-2.5, 2.5):
            Q = Pp + bok[None, :] * (off / R)
            inf.polilinia(m, Q / np.linalg.norm(Q, axis=1, keepdims=True), W, H, R)
        mp = np.zeros((H, W), np.float32)
        inf.polilinia(mp, Pp, W, H, R)
        pas = inf.poszerz(mp, 9.0 / px_km)
        kol = mix(kol, kol * 1.3, pas * 0.6)
        kol = mix(kol, PAL['tor'], inf.poszerz(m, 1.2 / px_km) * 0.85)
        wys += pas * 80.0
        Q, s = inf.probkuj(Pp, 7.0, R)
        u = s / max(s[-1], 1)
        seg = ((s / 7.0).astype(int) % 9) < 6
        sw.dodaj(Q, ((0.4 + 0.6 * u) * seg).astype(np.float32), 'tor', 1)
        sw.dodaj(Q[-1:], np.array([1.0], np.float32), 'tor', 2)
        del m, mp, pas
    log(f'wyrzutnie {len(pl["wyrzutnie"])}')

    # ── osiedla przy magistralach i dużych odnogach (Wenus ma więcej ludzi niż Merkury) ──────────────
    huby_xyz = np.array([kierunek_z_lonlat(lo, la) for lo, la, _ in pl['huby']])
    osiedla = 0
    for Pp, kl, fl in siec:
        if kl < 1:
            continue
        Q, t = inf.probkuj(Pp, rng.uniform(220, 520) * (1.0 if kl >= 2 else 1.8), R)
        for q in Q[1:]:
            if np.max(huby_xyz @ q) > math.cos(170.0 / R) or rng.random() < 0.3:
                continue
            # osiedle obok drogi, nie na niej (przesunięcie w bok 10–60 km)
            q = inf.rozrzut(q, 1, 60.0, rng, R)[0]
            lon_o, lat_o = math.degrees(math.atan2(q[1], q[0])), math.degrees(math.asin(q[2]))
            ro = float(rng.uniform(14, 32))
            rows, cols, x, y = inf.okno(lon_o, lat_o, ro * 1.6, W, H, R)
            d = np.sqrt(x * x + y * y) / (ro * (0.7 + 0.6 * inf.szum2(x, y, 1 / 6.0, osiedla + 950)))
            mo = smoothstep(1.0, 0.5, d)
            gr = inf.szum2(x, y, 1 / 1.8, osiedla + 951)
            sub = kol[np.ix_(rows, cols)]
            kol[np.ix_(rows, cols)] = sub + (PAL['miasto'][None, None, :] * (0.75 + 0.4 * gr[..., None]) - sub) * (mo * 0.5)[..., None]
            noc[np.ix_(rows, cols)] += NOC['biel'][None, None, :] * (mo * (0.2 + 0.8 * smoothstep(0.45, 0.85, gr)) * 0.8)[..., None]
            nl = int(14 + ro * 1.8)
            sw.dodaj(inf.rozrzut(q, nl, ro * 1.3, rng, R), (0.5 + 0.5 * rng.random(nl)).astype(np.float32), 'sod', 0)
            sw.dodaj(q[None, :], np.array([float(rng.uniform(0.3, 0.7))], np.float32), 'biel', 1)
            osiedla += 1
    log(f'osiedla {osiedla}')

    sw.wypiecz(noc, px_km)
    log('światła')

    # ── chmury: pasma kwasu siarkowego z dawnej mapy atmosfery, z przerwami ──────
    atm = wczytaj_obraz(os.path.join(KATALOG_REPO, 'public/assets/planety/solar/venus/venus_atmosphere.jpg'), W, H)
    La = rozmyj_kula(luminancja(atm), max(0.5, 25.0 / px_km))
    det = La / np.maximum(rozmyj_kula(La, max(1.0, 900.0 / px_km)), 1e-3)
    pole = pole_szumu(W, H, lambda x, y, z: fbm3(x + 0.3 * fbm3(x, y, z, 2.0, 2, 81), y, z * 1.5, 3.0, 5, 80))
    mch = smoothstep(0.92, 1.28, det + 0.35 * (pole - 0.5)) * 0.85 + 0.04
    mch = np.clip(mch * (0.7 + 0.3 * smoothstep(0.0, 25.0, np.abs(np.linspace(90, -90, H))[:, None])), 0, 1).astype(np.float32)
    tint = atm / np.maximum(atm.max(axis=-1, keepdims=True), 1e-3)                # barwa pasm, jasność niesie maska
    chm = lin_do_srgb(tint) * (mch ** (1 / 2.2))[..., None]                       # maska liniowa po odczycie sRGB
    del atm, La, det, pole
    log('chmury')

    # ── normalne ──────────────────────────────────────────────────────────────────
    h = e + wys
    nrm = normalne_z_wysokosci(h, R * 1000.0, P['przewyzszenie'])
    log('normalne')

    kol_srgb = lin_do_srgb(kol)
    noc_srgb = lin_do_srgb(np.clip(noc, 0, 1))
    zapisz_rgb(os.path.join(wyj, 'venus_hf_color.jpg'), kol_srgb, 92)
    zapisz_rgb(os.path.join(wyj, 'venus_hf_night.jpg'), noc_srgb, 92)
    zapisz_normalne(os.path.join(wyj, 'venus_hf_normal.jpg'), nrm, 95)
    zapisz_rgb(os.path.join(wyj, 'venus_hf_spec.jpg'), przeskaluj(rozmyj_kula(spec, 0.7), W // 2, H // 2), 90)
    zapisz_rgb(os.path.join(wyj, 'venus_hf_clouds.jpg'), przeskaluj_rgb(chm, W // 2, H // 2), 90)
    for nazwa, a in (('kolor', kol_srgb), ('noc', noc_srgb), ('chmury', chm), ('normalne', nrm * 0.5 + 0.5)):
        podglad(os.path.join(podglady, f'wenus-{nazwa}.png'), a)
    log(f'zapis → {wyj}')


def przeskaluj_rgb(a, W, H):
    return np.stack([przeskaluj(a[..., c], W, H) for c in range(3)], -1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--szer', type=int, default=2048)
    ap.add_argument('--do-gry', action='store_true', help='zapis do public/assets/planety/solar/venus/')
    ap.add_argument('--wyj', default=None)
    a = ap.parse_args()
    W, H = a.szer, a.szer // 2
    wyj = os.path.join(KATALOG_REPO, 'public', 'assets', 'planety', 'solar', 'venus') if a.do_gry else (a.wyj or os.path.join(KATALOG_REPO, '.tmp', 'planety', f'wenus-{W}'))
    generuj(W, H, wyj, os.path.join(KATALOG_REPO, '.tmp', 'planety', f'podglad-{W}'), a.do_gry)


if __name__ == '__main__':
    main()
