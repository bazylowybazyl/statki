# -*- coding: utf-8 -*-
"""Wspólne rysowanie infrastruktury na mapach planet: okna lokalne (km od punktu), sieć połączeń
(drzewo rozpinające + skróty), linie po wielkich kołach z antyaliasingiem, losowanie miejsc."""
import math

import numpy as np
from scipy.sparse.csgraph import minimum_spanning_tree

from wspolne import kierunek_z_lonlat, szum3


def okno(lon0, lat0, promien_km, W, H, R_km):
    """Wiersze, kolumny (zawinięte) i lokalne x (wschód), y (północ) w km wokół punktu."""
    dlat = promien_km / R_km
    cl = max(math.cos(math.radians(lat0)), 0.05)
    dlon = min(math.pi, dlat / cl)
    j0 = max(0, int((math.pi / 2 - (math.radians(lat0) + dlat)) / math.pi * H) - 1)
    j1 = min(H, int((math.pi / 2 - (math.radians(lat0) - dlat)) / math.pi * H) + 2)
    i_c = (math.radians(lon0) + math.pi) / (2 * math.pi) * W
    di = int(dlon / (2 * math.pi) * W) + 2
    cols = np.arange(int(i_c) - di, int(i_c) + di + 1) % W
    cols = np.unique(cols) if 2 * di + 1 >= W else cols
    rows = np.arange(j0, j1)
    lon = (cols + 0.5) / W * 2 * np.pi - np.pi
    lat = np.pi / 2 - (rows + 0.5) / H * np.pi
    dl = (lon - math.radians(lon0) + np.pi) % (2 * np.pi) - np.pi
    x = (R_km * np.cos(lat)[:, None] * dl[None, :]).astype(np.float32)
    y = np.broadcast_to((R_km * (lat - math.radians(lat0)))[:, None], x.shape).astype(np.float32)
    return rows, cols, x, y


def szum2(x, y, skala, ziarno):
    """Szum 2D w oknie (płaszczyzna z = ziarno)."""
    return szum3(x * skala, y * skala, np.full_like(x, ziarno * 13.37), ziarno)


def mieszaj(dst, rows, cols, barwa, t):
    """dst[okno] ← mix(dst, barwa, t); barwa: (3,) albo (h, w, 3)."""
    sub = dst[np.ix_(rows, cols)]
    b = barwa if np.ndim(barwa) == 3 else np.asarray(barwa)[None, None, :]
    dst[np.ix_(rows, cols)] = sub + (b - sub) * t[..., None]


def dodaj(dst, rows, cols, v):
    dst[np.ix_(rows, cols)] += v


def piksel_do_lonlat(j, i, W, H):
    return (i + 0.5) / W * 360 - 180, 90 - (j + 0.5) / H * 180


def losuj_miejsca(maska, n, rng, odstep_deg=0.0, krok=5, max_lat=80.0):
    """n punktów (lon, lat) z maski (H, W, bool), co najmniej `odstep_deg` od siebie (po kuli)."""
    H, W = maska.shape
    kand = np.argwhere(maska[::krok, ::krok]) * krok
    if len(kand) == 0:
        return []
    out = []
    for k in rng.permutation(len(kand)):
        j, i = kand[k]
        lon, lat = piksel_do_lonlat(j, i, W, H)
        if abs(lat) > max_lat:
            continue
        if odstep_deg > 0:
            d = kierunek_z_lonlat(lon, lat)
            if any(np.dot(d, kierunek_z_lonlat(a, b)) > math.cos(math.radians(odstep_deg)) for a, b in out):
                continue
        out.append((lon, lat))
        if len(out) >= n:
            break
    return out


def siec(wezly, R_km, maks_km=1e9, skroty=2, skrot_km=1e9):
    """Krawędzie: drzewo rozpinające (krótsze niż maks_km) + `skroty` najbliższych sąsiadów (krótsze niż skrot_km)."""
    xyz = np.array([kierunek_z_lonlat(lo, la) for lo, la in wezly])
    kat = np.arccos(np.clip(xyz @ xyz.T, -1, 1))
    mst = minimum_spanning_tree(kat).toarray()
    kraw = set((int(a), int(b)) for a, b in zip(*np.nonzero(mst)) if kat[a, b] * R_km < maks_km)
    for a in range(len(wezly)):
        for b in np.argsort(kat[a])[1:1 + skroty]:
            if kat[a, b] * R_km < skrot_km:
                kraw.add((min(a, int(b)), max(a, int(b))))
    return xyz, kraw


def linia(dst, A, B, W, H, R_km, waga=1.0, meandry_km=0.0, ziarno=0, przesuniecie_px=0.0):
    """Linia po wielkim kole A → B (kierunki jednostkowe) do maski dst (max), szerokość ~1 px z antyaliasingiem.
    Zwraca (j, i, t) próbek — do świateł wzdłuż linii (t ∈ [0, 1] wzdłuż)."""
    A = np.asarray(A, float)
    B = np.asarray(B, float)
    om = math.acos(max(-1.0, min(1.0, float(np.dot(A, B)))))
    if om < 1e-6:
        return None
    px_km = 2 * math.pi * R_km / W
    n_s = int(om * R_km / (px_km * 0.35)) + 2
    t = np.linspace(0, 1, n_s)
    so = math.sin(om)
    pts = (np.sin((1 - t) * om)[:, None] * A + np.sin(t * om)[:, None] * B) / so
    prost = np.cross(A, B)
    prost /= np.linalg.norm(prost) + 1e-12
    off = np.zeros_like(t)
    if meandry_km > 0:
        off += (np.sin(t * om * R_km / 140.0 + ziarno) * 0.6 + np.sin(t * om * R_km / 57.0 + 2 * ziarno) * 0.3) * meandry_km * np.sin(np.pi * t)
    off += przesuniecie_px * px_km
    pts = pts + prost[None, :] * (off / R_km)[:, None]
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
        np.maximum.at(dst, (jj, (i0 + di) % W), (w * waga).astype(np.float32))
    return np.clip(np.round(fj).astype(int), 0, H - 1), np.round(fi).astype(int) % W, t


# ── Trasy po terenie (Merkury, Wenus) ───────────────────────────────────────────
# Sieć logistyczna planety: najtańsze drogi po siatce równoodległej (16+ sąsiadów — bez kanciastych
# odcinków 0° / 45°), koszt z nachylenia; trasy kopalń zbiegają się w drzewo (Dijkstra z wieloma
# źródłami), więc z kopalń wychodzą odnogi, które łączą się w magistrale przy węzłach.
# 16 sąsiadów + dalsze skosy wiersza: na dużych szerokościach komórka jest wąska (cos φ), więc kierunki
# między 34° a 90° od południka bez (1, ±3…6) i (2, ±3/5) rozpadały się na długie odcinki wzdłuż równoleżnika
_SASIEDZI = ((0, 1), (1, -1), (1, 0), (1, 1), (1, -2), (1, 2), (2, -1), (2, 1),
             (1, -3), (1, 3), (1, -4), (1, 4), (1, -6), (1, 6), (2, -3), (2, 3), (2, -5), (2, 5))


def graf_terenu(koszt, R_km):
    """Graf nieskierowany siatki (H, W): waga = długość odcinka po kuli [km] × średni koszt komórek."""
    from scipy.sparse import coo_matrix
    H, W = koszt.shape
    lon = (np.arange(W) + 0.5) / W * 2 * np.pi - np.pi
    lat = np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi
    lo, la = np.meshgrid(lon, lat)
    xyz = np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], -1)
    idx = np.arange(H * W).reshape(H, W)
    a_l, b_l, w_l = [], [], []
    for dj, di in _SASIEDZI:
        a = idx[:H - dj]
        b = np.roll(idx[dj:], -di, axis=1)
        pa = xyz[:H - dj]
        pb = np.roll(xyz[dj:], -di, axis=1)
        d = R_km * np.arccos(np.clip((pa * pb).sum(-1), -1, 1))
        w = d * 0.5 * (koszt[:H - dj] + np.roll(koszt[dj:], -di, axis=1))
        a_l.append(a.ravel())
        b_l.append(b.ravel())
        w_l.append(w.ravel().astype(np.float64))
    a = np.concatenate(a_l)
    b = np.concatenate(b_l)
    w = np.maximum(np.concatenate(w_l), 1e-6)
    return coo_matrix((w, (a, b)), shape=(H * W, H * W)).tocsr()


def komorka(lon, lat, W, H):
    i = int((lon + 180.0) / 360.0 * W) % W
    j = min(H - 1, max(0, int((90.0 - lat) / 180.0 * H)))
    return j * W + i


def sciezka(pred, wezel):
    out = [wezel]
    while pred[out[-1]] >= 0:
        out.append(int(pred[out[-1]]))
    return out


def lancuchy(krawedzie):
    """Krawędzie {(a, b): przepływ} → łańcuchy węzłów między skrzyżowaniami [(węzły, przepływ)]."""
    sas = {}
    for (a, b) in krawedzie:
        sas.setdefault(a, []).append(b)
        sas.setdefault(b, []).append(a)
    uzyte = set()
    out = []
    for start in sas:
        if len(sas[start]) == 2:
            continue
        for nb in sas[start]:
            k = (min(start, nb), max(start, nb))
            if k in uzyte:
                continue
            ch = [start, nb]
            uzyte.add(k)
            while len(sas[ch[-1]]) == 2:
                nxt = sas[ch[-1]][0] if sas[ch[-1]][0] != ch[-2] else sas[ch[-1]][1]
                k = (min(ch[-1], nxt), max(ch[-1], nxt))
                if k in uzyte:
                    break
                uzyte.add(k)
                ch.append(nxt)
            fl = max(krawedzie[(min(ch[i], ch[i + 1]), max(ch[i], ch[i + 1]))] for i in range(len(ch) - 1))
            out.append((ch, fl))
    # pętle bez skrzyżowań (rzadkie) — pomijane
    return out


def wezly_do_xyz(wezly, W, H):
    wezly = np.asarray(wezly)
    j, i = wezly // W, wezly % W
    lon = (i + 0.5) / W * 2 * np.pi - np.pi
    lat = np.pi / 2 - (j + 0.5) / H * np.pi
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1)


def wygladz(P, okno_n=5, kotwice=True):
    """Średnia ruchoma punktów łańcucha (kierunki 3D), końce nieruchome."""
    if len(P) < 3 or okno_n < 2:
        return P
    k = np.ones(okno_n) / okno_n
    pad = okno_n // 2
    Q = np.empty_like(P)
    for c in range(3):
        x = np.concatenate([np.full(pad, P[0, c]), P[:, c], np.full(pad, P[-1, c])])
        Q[:, c] = np.convolve(x, k, mode='valid')[:len(P)]
    if kotwice:
        Q[0], Q[-1] = P[0], P[-1]
    return Q / np.linalg.norm(Q, axis=1, keepdims=True)


def probkuj(P, krok_km, R_km):
    """Punkty co `krok_km` wzdłuż łamanej (kierunki 3D) → (punkty, odległość wzdłuż [km])."""
    seg = R_km * np.arccos(np.clip((P[:-1] * P[1:]).sum(1), -1, 1))
    s = np.concatenate([[0.0], np.cumsum(seg)])
    if s[-1] <= 0:
        return P[:1], np.zeros(1)
    t = np.arange(0.0, s[-1], krok_km)
    Q = np.stack([np.interp(t, s, P[:, c]) for c in range(3)], -1)
    return Q / np.linalg.norm(Q, axis=1, keepdims=True), t


def do_pikseli(Q, W, H):
    lat = np.arcsin(np.clip(Q[:, 2], -1, 1))
    lon = np.arctan2(Q[:, 1], Q[:, 0])
    return (np.pi / 2 - lat) / np.pi * H - 0.5, (lon + np.pi) / (2 * np.pi) * W - 0.5


def polilinia(dst, P, W, H, R_km, waga=1.0):
    """Łamana (kierunki 3D) do maski dst (max), ~1 px z antyaliasingiem."""
    px_km = 2 * np.pi * R_km / W
    Q, _ = probkuj(P, px_km * 0.35, R_km)
    fj, fi = do_pikseli(Q, W, H)
    i0 = np.floor(fi).astype(int)
    j0 = np.floor(fj).astype(int)
    wi, wj = fi - i0, fj - j0
    w_arr = np.broadcast_to(np.asarray(waga, np.float32), wi.shape) if np.ndim(waga) else None
    for di, dj, w in ((0, 0, (1 - wi) * (1 - wj)), (1, 0, wi * (1 - wj)), (0, 1, (1 - wi) * wj), (1, 1, wi * wj)):
        jj = np.clip(j0 + dj, 0, H - 1)
        v = w * (w_arr if w_arr is not None else waga)
        np.maximum.at(dst, (jj, (i0 + di) % W), v.astype(np.float32))


def punkty(dst, Q, W, H, wartosci):
    """Kierunki 3D → dodanie wartości (bilinearnie) do mapy dst (H, W)."""
    fj, fi = do_pikseli(Q, W, H)
    i0 = np.floor(fi).astype(int)
    j0 = np.floor(fj).astype(int)
    wi, wj = fi - i0, fj - j0
    v = np.broadcast_to(np.asarray(wartosci, np.float32), wi.shape)
    for di, dj, w in ((0, 0, (1 - wi) * (1 - wj)), (1, 0, wi * (1 - wj)), (0, 1, (1 - wi) * wj), (1, 1, wi * wj)):
        jj = np.clip(j0 + dj, 0, H - 1)
        np.add.at(dst, (jj, (i0 + di) % W), (w * v).astype(np.float32))


def poszerz(maska, sigma_px):
    """Linia ~1 px → pas o szerokości ~2,5 σ i szczycie 1 (rozmycie Gaussa znormalizowane do szczytu)."""
    from wspolne import rozmyj_kula
    s = max(0.45, float(sigma_px))
    return np.clip(rozmyj_kula(maska, s) * (math.sqrt(2 * math.pi) * s), 0.0, 1.0).astype(np.float32)


def rozlej(mapa, sigma_px):
    """Punkty (impulsy) → plamy Gaussa o szczycie równym wartości impulsu."""
    from wspolne import rozmyj_kula
    s = max(0.45, float(sigma_px))
    return (rozmyj_kula(mapa, s) * (2 * math.pi * s * s)).astype(np.float32)


def nachylenie(e, R_km):
    """Moduł gradientu [m/m] mapy wysokości (m) równoodległej."""
    H, W = e.shape
    lat = np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi
    dx = (R_km * 1000.0 * np.maximum(np.cos(lat), 0.05) * 2 * np.pi / W)[:, None]
    dy = R_km * 1000.0 * np.pi / H
    gx = (np.roll(e, -1, 1) - np.roll(e, 1, 1)) / (2 * dx)
    gy = np.zeros_like(e)
    gy[1:-1] = (e[:-2] - e[2:]) / (2 * dy)
    return np.hypot(gx, gy).astype(np.float32)


def rozrzut(Q0, n, promien_km, rng, R_km):
    """n kierunków losowo w kole wokół Q0 (kierunek 3D)."""
    a = rng.uniform(0, 2 * math.pi, n)
    r = promien_km * np.sqrt(rng.uniform(0, 1, n)) / R_km
    t1 = np.cross(Q0, [0, 0, 1.0])
    if np.linalg.norm(t1) < 1e-6:
        t1 = np.array([1.0, 0, 0])
    t1 /= np.linalg.norm(t1)
    t2 = np.cross(Q0, t1)
    Q = Q0[None, :] + (np.cos(a) * r)[:, None] * t1[None, :] + (np.sin(a) * r)[:, None] * t2[None, :]
    return Q / np.linalg.norm(Q, axis=1, keepdims=True)


class Swiatla:
    """Punkty świateł w klasach rozmiaru [km] i barwach palety nocy — rozlewane Gaussem na końcu."""

    def __init__(self, W, H, paleta, rozmiary=(2.2, 3.8, 7.5)):
        self.W, self.H = W, H
        self.paleta = paleta
        self.rozmiary = rozmiary
        self.mapy = {}

    def dodaj(self, Q, wart, barwa, rozm=0):
        if len(Q) == 0:
            return
        k = (barwa, rozm)
        if k not in self.mapy:
            self.mapy[k] = np.zeros((self.H, self.W), np.float32)
        punkty(self.mapy[k], Q, self.W, self.H, wart)

    def wypiecz(self, noc, px_km):
        for (barwa, rozm), m in self.mapy.items():
            noc += self.paleta[barwa][None, None, :] * rozlej(m, self.rozmiary[rozm] / px_km)[..., None]
        self.mapy = {}


def przecen(G, krawedzie, mnoznik):
    """Kopia grafu z kosztem krawędzi (u, v) × mnożnik (obie orientacje)."""
    G2 = G.copy()
    G2.sort_indices()
    for u, v in krawedzie:
        for a, b in ((u, v), (v, u)):
            s, e = G2.indptr[a], G2.indptr[a + 1]
            k = np.searchsorted(G2.indices[s:e], b)
            if k < e - s and G2.indices[s + k] == b:
                G2.data[s + k] *= mnoznik
    return G2


def odnogi_do_hub(G, magistrale, huby, zrodla, W, H, tanio=0.45, wspolne=0.7):
    """Odnogi kopalń prowadzone do HUTY, z tańszą jazdą po magistralach (× `tanio`): droga dojazdowa
    wpada w magistralę pod kątem ostrym, skierowana ku hucie (prawo załamania: cos θ = tanio), zamiast
    prostopadłym grzebieniem. Drugi przebieg tanieje też odnogi wspólne ≥ 2 kopalniom (× `wspolne`),
    więc sąsiednie kopalnie zbiegają się w jedną odnogę (dorzecze).

    Zwraca {(a, b): przepływ} krawędzi spoza magistral."""
    from scipy.sparse.csgraph import dijkstra
    kom = [komorka(lo, la, W, H) for lo, la, _ in zrodla]
    G1 = przecen(G, magistrale, tanio)
    przeplyw = {}
    for przebieg in range(2):
        _, pred, _ = dijkstra(G1, directed=False, indices=huby, return_predecessors=True, min_only=True)
        przeplyw = {}
        licz = {}
        for (lo, la, wg), s in zip(zrodla, kom):
            sc = sciezka(pred, s)
            for u, v in zip(sc[:-1], sc[1:]):
                k = (min(u, v), max(u, v))
                if k in magistrale:
                    continue
                przeplyw[k] = przeplyw.get(k, 0.0) + wg
                licz[k] = licz.get(k, 0) + 1
        if przebieg == 0:
            G1 = przecen(G1, [k for k, n in licz.items() if n >= 2], wspolne)
    return przeplyw
