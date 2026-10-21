# -*- coding: utf-8 -*-
"""Wielki gryz Ziemi: brzeg gryzu (lustro β z src/3d/earthBite.tsl.js i src/3d/earthBiteShape.js) i wypiek
okolic brzegu w mapach: przypalony pas przy krawędzi, hałdy, fronty koparek w łukach zębów, huty, obwodnica,
tory wyrzutni masy; nocą łuna brzegu, huty, fronty i tory. Wnętrze gryzu rysuje bryła (shader) — w mapach
ciemna skała bez świateł, normalne płaskie, bez chmur. Parametry: src/data/earthBite.js (blok EARTH_BITE)."""
import math
import os

import numpy as np

from wspolne import (KATALOG_REPO, kierunki, kolor, mix, pasy, smoothstep, szum3,
                     wczytaj_json_z_js)


def parametry(promien=None):
    par = wczytaj_json_z_js(os.path.join(KATALOG_REPO, 'src', 'data', 'earthBite.js'), 'EARTH_BITE')
    if promien:
        par['radiusR'] = float(promien)
    return par


def osie(par):
    """Środek c, wschód e, północ n w układzie `kierunki` (x = (0°, 0°), y = 90° E, z = biegun N)."""
    lo, la = math.radians(par['lon']), math.radians(par['lat'])
    c = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    e = np.array([-math.sin(lo), math.cos(lo), 0.0])
    n = np.array([-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)])
    return c, e, n


def luk_zebow(phi, par):
    """Łuki zębów: 4t(1 − t) − 2/3 (lustro teethArc / betaNode); t — położenie w łuku (0, 1)."""
    pw = phi + par['teethWarp'] * np.sin(phi + math.radians(par['teethPhase']))
    t = np.mod(par['teeth'] * pw / (2 * math.pi), 1.0)
    return 4.0 * t * (1.0 - t) - 2.0 / 3.0, t


def beta_brzeg(phi, par):
    """β na brzegu (cięciwa od środka gryzu do brzegu, R = 1) w azymucie phi (0 = wschód, ku północy)."""
    lob = np.zeros_like(phi)
    for k, amp, faza in par['lobes']:
        lob = lob + amp * np.cos(k * (phi - math.radians(faza)))
    arc, _ = luk_zebow(phi, par)
    return par['radiusR'] * (1.0 + lob + par['teethAmp'] * arc)


P_BRZEG = kolor('#3a2c26')      # przypalona skała przy krawędzi (żużel)
P_HALDA = kolor('#7d746a')
P_HALDA_C = kolor('#5a524a')
P_HUTA = kolor('#3d3c3e')
P_DROGA = kolor('#c4bbab')
P_FRONT = kolor('#26221f')
P_WNETRZE = kolor('#2a1c16')
N_LUNA = kolor('#ff6a1e')
N_SOD = kolor('#ffb35a')
N_HUTA = kolor('#ffd9a0')
N_TOR = kolor('#bfe0ff')


def wypiecz(par, kol, noc, W, H, R_km):
    """Okolice gryzu w mapach (w miejscu). Zwraca (kol, noc, maska bez normalnych, mnożnik chmur)."""
    c, e, n = osie(par)
    maska = np.zeros((H, W), bool)
    chmury = np.ones((H, W), np.float32)
    b = par['radiusR']
    bmax = b * (1.0 + sum(abs(l[1]) for l in par['lobes']) + par['teethAmp'] * 0.34)
    zasieg = 2.0 * math.asin(min(1.0, bmax / 2.0)) + 900.0 / R_km
    px_km = 2 * math.pi * R_km / W
    # huty: kilkanaście zespołów za brzegiem (azymut, odległość od brzegu [km]) — stałe ziarno
    rng = np.random.default_rng(4242)
    huty = [(rng.uniform(0, 2 * math.pi), rng.uniform(70, 260), rng.uniform(25, 55)) for _ in range(16)]
    for j0, j1 in pasy(H):
        x, y, z = kierunki(W, H, j0, j1)
        cz = x * c[0] + y * c[1] + z * c[2]
        if cz.max() < math.cos(zasieg):
            continue
        a = x * e[0] + y * e[1] + z * e[2]
        bb = x * n[0] + y * n[1] + z * n[2]
        phi = np.arctan2(bb, a)
        dist = np.sqrt(np.maximum(2.0 - 2.0 * cz, 0.0))       # cięciwa od środka gryzu
        br = beta_brzeg(phi, par)
        dkm = (dist - br) * R_km                               # od brzegu na zewnątrz [km]
        wewn = dist < br + par['skirtPad']                     # pod łatą (kula wycięta, kołnierz)
        maska[j0:j1] |= wewn
        szum = szum3(x * 900.0, y * 900.0, z * 900.0, 411)
        szum_d = szum3(x * 3000.0, y * 3000.0, z * 3000.0, 412)
        szum_h = szum3(x * 2200.0, y * 2200.0, z * 2200.0, 414)
        blok = kol[j0:j1]
        nblok = noc[j0:j1]
        # wnętrze: ciemna skała (bez świateł) — mipmapy nie wciągają w brzeg jasnego gruntu
        t_in = smoothstep(par['skirtPad'] * R_km * 0.5, -10.0, dkm)[..., None]
        blok[:] = blok + (P_WNETRZE * (0.8 + 0.4 * szum_d[..., None]) - blok) * t_in
        nblok[:] = nblok * (1.0 - t_in)
        # przypalony pas przy krawędzi: żużel, spękania (żar wydobycia), szerokość zmienna wzdłuż brzegu
        szer = 55.0 + 45.0 * szum
        t_b = smoothstep(szer, 0.0, dkm) * (dkm > -5.0)
        blok[:] = mix(blok, P_BRZEG[None, None, :] * (0.7 + 0.6 * szum_d[..., None]), (t_b * 0.85)[..., None])
        # hałdy: pas 20–320 km, plamy i promieniste smugi zsypów
        sm = 0.5 + 0.5 * np.sin(phi * 140.0 + szum * 6.0)
        t_h = smoothstep(15.0, 45.0, dkm) * smoothstep(320.0 + 120.0 * szum, 120.0, dkm) * smoothstep(0.35, 0.6, szum_h * 0.7 + sm * 0.3)
        halda = P_HALDA[None, None, :] + (P_HALDA_C - P_HALDA)[None, None, :] * smoothstep(0.3, 0.8, szum_d)[..., None]
        blok[:] = mix(blok, halda * (0.75 + 0.5 * szum_h[..., None]), (t_h * 0.8)[..., None])
        # fronty koparek: w środku każdego łuku zęba, przy samej krawędzi (ciemny prostokąt, nocą światła)
        _, tz = luk_zebow(phi, par)
        front = smoothstep(0.12, 0.03, np.abs(tz - 0.5)) * smoothstep(-5.0, 5.0, dkm) * smoothstep(70.0, 30.0, dkm)
        blok[:] = mix(blok, P_FRONT[None, None, :], (front * 0.9)[..., None])
        sw_front = front * smoothstep(0.55, 0.8, szum3(x * 9000.0, y * 9000.0, z * 9000.0, 415))
        # obwodnica: droga wzdłuż brzegu ~120 km za krawędzią (falowana), drogi ku hutom
        obw = smoothstep(3.0, 0.0, np.abs(dkm - 120.0 - 30.0 * (szum - 0.5)))
        blok[:] = mix(blok, P_DROGA[None, None, :], (obw * 0.6)[..., None])
        # huty: zespoły kwartałów (szum kratki) z jasnym rdzeniem nocą
        t_hut = np.zeros_like(dkm)
        for az, odl, rkm in huty:
            dphi = np.angle(np.exp(1j * (phi - az)))
            dx = dphi * (br * R_km)
            dy = dkm - odl
            d = np.sqrt(dx * dx + dy * dy)
            t_hut = np.maximum(t_hut, smoothstep(rkm, rkm * 0.4, d))
        kwartal = smoothstep(0.45, 0.6, szum3(x * 14000.0, y * 14000.0, z * 14000.0, 416))
        blok[:] = mix(blok, P_HUTA[None, None, :] * (0.7 + 0.6 * kwartal[..., None]), (t_hut * 0.85)[..., None])
        kol[j0:j1] = blok
        # noc: łuna brzegu (żar i dym nad krawędzią, poszarpana), huty, fronty, obwodnica
        # łuna: poszarpana (plamy i przerwy wzdłuż brzegu), nie jednolity pierścień
        plamy = smoothstep(0.42, 0.78, szum3(x * 260.0, y * 260.0, z * 260.0, 417)) * (0.4 + 0.6 * smoothstep(0.3, 0.85, szum_d))
        luna = smoothstep(70.0 + 90.0 * szum, 0.0, dkm) * (dkm > -2.0) * plamy
        nn = (N_LUNA[None, None, :] * (luna * 0.4)[..., None]
              + N_HUTA[None, None, :] * (t_hut * kwartal * 0.9)[..., None]
              + N_SOD[None, None, :] * (sw_front * 0.9 + obw * 0.25 * smoothstep(0.5, 0.7, szum_h))[..., None])
        noc[j0:j1] = np.maximum(nblok, nn * (1.0 - t_in))
        # chmury: nad otworem i tuż za brzegiem nie ma (żar, wznoszenie)
        chmury[j0:j1] = smoothstep(40.0, 400.0, dkm).astype(np.float32)
    for az, dl in par['massDrivers']:
        tor(kol, noc, par, az, dl, W, H, R_km)
    return kol, noc, maska, chmury


def tor(kol, noc, par, az_deg, dlugosc_km, W, H, R_km):
    """Tor wyrzutni masy: wielkie koło od brzegu gryzu w azymucie az (0 = wschód, CCW)."""
    c, e, n = osie(par)
    az = math.radians(az_deg)
    d = math.cos(az) * e + math.sin(az) * n
    br = float(beta_brzeg(np.array([az]), par)[0])
    start = 2.0 * math.asin(min(1.0, br / 2.0)) + 160.0 / R_km
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
