# -*- coding: utf-8 -*-
"""Wielka kopalnia ringu na Ziemi: profil (lustro shadera bryły, src/3d/earthPit.tsl.js)
i wypiek barw / świateł nocy w mapach. Parametry: src/data/earthPit.js (blok EARTH_PIT)."""
import math
import os

import numpy as np

from wspolne import (KATALOG_REPO, kierunki, kolor, mix, pasy, smoothstep, szum3,
                     wczytaj_json_z_js)


def parametry():
    return wczytaj_json_z_js(os.path.join(KATALOG_REPO, 'src', 'data', 'earthPit.js'), 'EARTH_PIT')


def osie(par):
    """Środek c, wschód e, północ n w układzie `kierunki` (x = (0°, 0°), y = 90° E, z = biegun N)."""
    lo, la = math.radians(par['lon']), math.radians(par['lat'])
    c = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    e = np.array([-math.sin(lo), math.cos(lo), 0.0])
    n = np.array([-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)])
    return c, e, n


def profil(a, b, cz, par, R_km):
    """Wysokość względem krawędzi [km] (ujemna w dziurze), s (0 środek, 1 krawędź) i azymut.

    a, b, cz = rzut kierunku na oś wschód, północ i środek dziury. LUSTRO `earthPitProfile`
    w src/3d/earthPit.tsl.js — zmiana tu = zmiana tam (test tests/earthPit.test.mjs)."""
    rho = np.arctan2(np.sqrt(a * a + b * b), cz)
    phi = np.arctan2(b, a)
    obrys = np.ones_like(rho)
    for k, amp, faza in par['lobes']:
        obrys = obrys + amp * np.cos(k * (phi - math.radians(faza)))
    s = rho / ((par['radiusKm'] / R_km) * obrys)
    N = float(par['benches'])
    fl = par['floor']
    f = 1.0 - np.clip((s - fl) / (1.0 - fl), 0.0, 1.0)
    f = f + par['benchWarp'] * (0.5 + 0.5 * np.sin(2.0 * phi + 1.0)) * np.sin(np.pi * par['benchWarpWaves'] * f)
    q = f * N
    k = np.floor(q)
    st = smoothstep(1.0 - par['riser'], 1.0, q - k)
    glebokosc = par['depthKm'] * (k + st) / N
    szyb = par['shaftDepthKm'] * np.sqrt(np.clip(1.0 - (s / par['shaftR']) ** 2, 0.0, 1.0))
    wal = par['rimBermKm'] * np.sin(np.pi * np.clip((s - 1.0) / par['rimWidth'], 0.0, 1.0))
    return (wal - glebokosc - szyb).astype(np.float32), s.astype(np.float32), phi.astype(np.float32), (q - k).astype(np.float32)


STRATA = [kolor(h) for h in ('#a88a66', '#8a5e46', '#9a9282', '#6e6254', '#b29a7a', '#56504a',
                              '#857a70', '#6a4a3a', '#8e887c', '#45403c', '#76604f', '#3a302a')]
P_POLKA = kolor('#9a8f7f')
P_POLKA_GL = kolor('#5e554b')
P_DNO = kolor('#3a302a')
P_SZYB = kolor('#2a1a14')
P_WAL = kolor('#8c8175')
P_DROGA = kolor('#c4bbab')
N_SOD = kolor('#ffb35a')
N_ZAR = kolor('#ff5a1a')
N_GLEB = kolor('#ff3a10')
N_TOR = kolor('#bfe0ff')


def wypiecz(par, kol, noc, W, H, R_km):
    """Barwy i światła dziury w mapach (w miejscu). Zwraca (kol, noc, wysokość m, maska bez normalnych)."""
    c, e, n = osie(par)
    wys = np.zeros((H, W), np.float32)
    maska = np.zeros((H, W), bool)
    zasieg = (par['radiusKm'] / R_km) * (1.0 + sum(abs(l[1]) for l in par['lobes'])) * (1.0 + par['rimWidth']) * 1.05
    D = par['depthKm']
    for j0, j1 in pasy(H):
        x, y, z = kierunki(W, H, j0, j1)
        cz = x * c[0] + y * c[1] + z * c[2]
        if cz.max() < math.cos(zasieg):
            continue
        a = x * e[0] + y * e[1] + z * e[2]
        b = x * n[0] + y * n[1] + z * n[2]
        h, s, phi, fr = profil(a, b, cz, par, R_km)
        w = s < 1.0 + par['rimWidth']
        if not w.any():
            continue
        maska[j0:j1] |= w & (cz > 0)
        gl = np.clip(-h, 0, None)
        zf = np.clip(gl / D, 0, 1.4)
        szum = szum3(x * 900.0, y * 900.0, z * 900.0, 311)
        szum_d = szum3(x * 3000.0, y * 3000.0, z * 3000.0, 312)
        # warstwy skał na skarpach (pasy wg głębokości, falowane szumem)
        idx = (zf * 11.0 + (szum - 0.5) * 0.9) % len(STRATA)
        i0 = np.floor(idx).astype(int) % len(STRATA)
        i1 = (i0 + 1) % len(STRATA)
        tt = smoothstep(0.7, 1.0, idx - np.floor(idx))
        S = np.stack(STRATA)
        strata = S[i0] + (S[i1] - S[i0]) * tt[..., None]
        skarpa = smoothstep(1.0 - par['riser'] * 1.1, 1.0 - par['riser'] * 0.6, fr) * (s < 1.0) * (s > par['floor'])
        polka = mix(P_POLKA[None, None, :] * np.ones(x.shape + (1,), np.float32), P_POLKA_GL, smoothstep(0.1, 1.0, zf))
        polka = mix(polka, strata * 1.1, 0.4)                  # półka odsłania skałę swojego poziomu, pod pyłem
        polka = polka * (0.8 + 0.4 * szum_d[..., None])
        wn = mix(polka, strata * (0.8 + 0.4 * szum_d[..., None]), skarpa)
        wn = mix(wn, P_DNO[None, None, :] * (0.8 + 0.4 * szum[..., None]), smoothstep(par['floor'] + 0.02, par['floor'] - 0.02, s))
        wn = mix(wn, P_SZYB, smoothstep(par['shaftR'] * 1.05, par['shaftR'] * 0.9, s))
        # spiralne drogi transportowe na półkach
        ramie = 2 * math.pi / par['spiralArms']
        kat = (phi - par['spiralTurns'] * 2 * math.pi * (1.0 - s)) % ramie
        droga = smoothstep(0.035, 0.0, np.minimum(kat, ramie - kat)) * (s < 0.98) * (s > par['floor']) * (1 - skarpa)
        wn = mix(wn, P_DROGA, droga * 0.7)
        # wał hałd za krawędzią
        wal_t = smoothstep(1.0, 1.02, s) * smoothstep(1.0 + par['rimWidth'], 1.0 + par['rimWidth'] * 0.6, s)
        hald = szum3(x * 2200.0, y * 2200.0, z * 2200.0, 314)
        wn = mix(wn, P_WAL[None, None, :] * (0.55 + 0.75 * hald[..., None]) * (0.85 + 0.3 * szum[..., None]), wal_t * 0.85)
        t = smoothstep(1.0 + par['rimWidth'], 1.0 + par['rimWidth'] * 0.7, s) * (cz > 0)
        blok = kol[j0:j1]
        kol[j0:j1] = blok + (wn - blok) * t[..., None]
        # noc: łańcuchy świateł na krawędziach półek, drogi, rozżarzony szyb
        lancuch = smoothstep(0.93, 0.99, fr) * (s < 1.0) * (s > par['floor']) * smoothstep(0.5, 0.75, szum3(x * 6000.0, y * 6000.0, z * 6000.0, 313))
        zar = smoothstep(par['shaftR'], 0.0, s) ** 1.5
        dno_sw = smoothstep(par['floor'], par['shaftR'], s) * smoothstep(0.82, 0.95, szum_d)
        nn = (N_SOD[None, None, :] * (lancuch * 0.55 + droga * 0.6 + dno_sw * 0.6)[..., None]
              + N_ZAR[None, None, :] * (zar * 0.9)[..., None] + N_GLEB[None, None, :] * (smoothstep(par['shaftR'] * 0.5, 0.0, s) * 0.6)[..., None])
        noc[j0:j1] = noc[j0:j1] * (1 - t[..., None]) + nn * t[..., None]
        wys[j0:j1] = np.where(w, h * 1000.0, 0.0)
    # wyrzutnie masy: długie tory od krawędzi
    for az, dl in par['massDrivers']:
        tor(kol, noc, par, az, dl, W, H, R_km)
    return kol, noc, wys, maska


def tor(kol, noc, par, az_deg, dlugosc_km, W, H, R_km):
    """Tor wyrzutni masy: wielkie koło od krawędzi dziury w azymucie az (0 = wschód, CCW)."""
    c, e, n = osie(par)
    az = math.radians(az_deg)
    d = math.cos(az) * e + math.sin(az) * n
    ob = 1.0 + sum(l[1] * math.cos(l[0] * (az - math.radians(l[2]))) for l in par['lobes'])
    start = (par['radiusKm'] / R_km) * ob * (1.0 + par['rimWidth'])
    px_km = 2 * math.pi * R_km / W
    t = np.linspace(start, start + dlugosc_km / R_km, int(dlugosc_km / (px_km * 0.3)) + 2)
    for off in (-0.55, 0.55):
        bok = np.cross(c, d)
        pts = np.cos(t)[:, None] * c[None, :] + np.sin(t)[:, None] * d[None, :] + bok[None, :] * (off * px_km / R_km)
        pts /= np.linalg.norm(pts, axis=1, keepdims=True)
        lat = np.arcsin(np.clip(pts[:, 2], -1, 1))
        lon = np.arctan2(pts[:, 1], pts[:, 0])
        i = (np.floor((lon + np.pi) / (2 * np.pi) * W).astype(int)) % W
        j = np.clip(np.floor((np.pi / 2 - lat) / np.pi * H).astype(int), 0, H - 1)
        kol[j, i] = kol[j, i] * 0.35 + P_DROGA * 0.65
        u = (t - start) / (t[-1] - start)
        noc[j, i] = np.maximum(noc[j, i], N_TOR[None, :] * (0.55 + 0.45 * (np.sin(u * 140.0) > 0.6))[:, None] * (1.0 - u * 0.5)[:, None])
