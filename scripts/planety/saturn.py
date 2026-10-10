# -*- coding: utf-8 -*-
"""Mapa Saturna gry (2026-10-09, prośba użytkownika: dobra mapa i animowana atmosfera Saturna).

Saturn nie ma publicznej globalnej mapy Cassini w dobrej jakości (są tylko wycinki i mapy biegunów), więc mapa jest
SKŁADANA:
  • BARWY I UKŁAD PASÓW — z map Hubble'a programu OPAL (Outer Planet Atmospheres Legacy, A. Simon, NASA GSFC;
    MAST HLSP doi:10.17909/T9G593 — dane publiczne): złożenia barwne F631N / F502N / F395N z lat 2019–2025,
    0,2°/px, szerokość planetograficzna. Pas pierścieni i cienie (czarne) pominięte, półkule z lat, w których je
    widać (płn. 2019–2022, płd. 2024–2025). Z profilu barwy w szerokości bierze się JASNOŚĆ pasów (prawdziwy
    układ), a barwę ustawia paleta po szerokości — wygląd z referencji użytkownika (Cassini w barwach wzmocnionych:
    złoto-pomarańczowe pasy, kremowy równik z chłodnym odcieniem, NIEBIESKI biegun płn. z sześciokątem i okiem).
  • DETAL — proceduralnie, z fizyką z danych: falowanie granic pasów i wiry w strefach ścinania profilu wiatru
    Cassini (src/data/saturnAtmosphere.js), smugi wzdłuż równoleżników, drobne chmury konwekcyjne.
  • OBIEKTY w położeniach ze wspólnych danych (src/data/saturnAtmosphere.js — te same czyta gra, która je obraca):
    pas po Wielkiej Białej Plamie 2010–2011 (głowa 32,6° N, ogon dookoła planety), jej anticyklon, fala wstęgowa
    42° N, aleja burz 35–41° S z owalami, owale 60° N / 52° S, SZEŚCIOKĄT 75,4° N (linie prądu wg tego samego
    kształtu co shader: gasGiantAtmosphere.tsl.js polygonShapeCpu), wiry polarne N i S (oko, ściana oka, ramiona).

Wynik: `public/assets/planety/solar/saturn/saturn_hf_color.jpg` (8192 × 4096; kolumna 0 = 180° W, wiersz 0 =
biegun N, szerokość PLANETOCENTRYCZNA liniowo — jak mapa Jowisza).

Dane (raz, `.tmp/saturn-dane/`, poza repo):
  curl -L -o .tmp/saturn-dane/opal_2019a.tif https://archive.stsci.edu/hlsps/opal/cycle26/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2019a_f395n-f502n-f631n_v1_globalmap.tif
  (… 2020a / cycle27, 2022a / cycle29, 2024a / cycle31; 2025a: https://archive.stsci.edu/missions/hlsp/opal/cycle32/saturn/…)

  .tmp/venv-planety/Scripts/python -I scripts/planety/saturn.py [--szer 2048] [--do-gry]
"""
import argparse
import math
import os
import sys
import time

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wspolne import (KATALOG_REPO, fbm3, kolor, lin_do_srgb, pasy, podglad, smoothstep, srgb_do_lin,  # noqa: E402
                     szum3, wczytaj_json_z_js, zapisz_rgb)

DANE = os.path.join(KATALOG_REPO, '.tmp', 'saturn-dane')
WYJSCIE = os.path.join(KATALOG_REPO, 'public', 'assets', 'planety', 'solar', 'saturn', 'saturn_hf_color.jpg')
PODGLAD = os.path.join(KATALOG_REPO, '.tmp', 'planety', 'saturn')
SA = wczytaj_json_z_js(os.path.join(KATALOG_REPO, 'src', 'data', 'saturnAtmosphere.js'), 'SATURN_ATM')
D2R = math.pi / 180.0
FLAT2 = (SA['radiusPolarKm'] / SA['radiusEqKm']) ** 2

# Mapy OPAL: rok → półkule, z których się bierze (płn. lato 2017 — mapy 2019–2022 widzą północ, 2024–2025 —
# także południe; pas pierścieni jest czarny i odpada z maską).
OPAL = {'2019a': (True, False), '2020a': (True, False), '2022a': (True, False), '2024a': (True, True), '2025a': (False, True)}

# Paleta po szerokości planetocentrycznej (sRGB) — barwy z referencji (Cassini, barwy wzmocnione), jasność
# z OPAL. Punkty kontrolne [φc, barwa]; między nimi interpolacja w liniowym RGB.
PALETA = [
    (-90.0, '#6d5a45'), (-86.0, '#8d7558'), (-78.0, '#a98e68'), (-70.0, '#b89a6c'), (-62.0, '#c4a271'),
    (-54.0, '#cfa56b'), (-46.0, '#d4a466'), (-40.0, '#d29a5a'), (-33.0, '#d9a663'), (-26.0, '#dfb877'),
    (-18.0, '#e6c78e'), (-11.0, '#eed9aa'), (-5.0, '#f1e6c7'), (0.0, '#ece9d6'), (5.0, '#f0e6c6'),
    (11.0, '#ecd6a4'), (18.0, '#e3c088'), (25.0, '#dcae6e'), (31.0, '#d49455'), (36.0, '#cf8a4c'),
    (41.0, '#d29a58'), (47.0, '#cba267'), (53.0, '#c3a66f'), (58.0, '#b5a579'), (62.0, '#a39f83'),
    (66.0, '#8b9894'), (69.5, '#7b8fa4'), (73.0, '#6a89b2'), (77.0, '#4d79b8'), (82.0, '#4672b4'),
    (86.0, '#3d68ad'), (90.0, '#2c4f8c'),
]


def lat_c(graf_deg):
    return np.degrees(np.arctan(np.tan(np.radians(graf_deg)) * FLAT2))


# ── Profil z OPAL ──────────────────────────────────────────────────────────────
# Pas równikowy: pierścienie i ich cień (2024–2025 krawędzią, wcześniej nad półkulą płd.) psują wiersze OPAL
# przy równiku — tam profil tylko z interpolacji (strukturę daje szum), bez danych.
OPAL_BEZ_ROWNIKA = 9.0


def profil_opal(krok=0.05):
    """Profil barwy (liniowo) w szerokości planetocentrycznej co `krok` stopni: (lat[], rgb[n, 3], dane[n])."""
    siatka = np.arange(-90 + krok / 2, 90, krok)
    suma = np.zeros((len(siatka), 3))
    wagi = np.zeros(len(siatka))
    for rok, (pn, ps) in OPAL.items():
        sciezka = os.path.join(DANE, f'opal_{rok}.tif')
        if not os.path.exists(sciezka):
            print('  brak', sciezka)
            continue
        a = np.asarray(Image.open(sciezka).convert('RGB'), dtype=np.float32) / 255.0
        H0 = a.shape[0]
        lum = a.mean(axis=2)
        maska = ndimage.binary_erosion(lum > 0.06, iterations=4)
        lin = srgb_do_lin(a)
        rows_lat = 90.0 - (np.arange(H0) + 0.5) * 180.0 / H0
        med = np.full((H0, 3), np.nan)
        for j in range(H0):
            m = maska[j]
            if m.mean() < 0.3:
                continue
            med[j] = np.median(lin[j][m], axis=0)
        latc = lat_c(rows_lat)
        ok = ~np.isnan(med[:, 0])
        ok &= ((latc >= OPAL_BEZ_ROWNIKA) & pn) | ((latc <= -OPAL_BEZ_ROWNIKA) & ps)
        if ok.sum() < 20:
            continue
        prof = np.stack([np.interp(siatka, latc[ok][::-1], med[ok][::-1, c], left=np.nan, right=np.nan) for c in range(3)], 1)
        jest = ~np.isnan(prof[:, 0])
        # wyrównanie jasności do dotychczasowej średniej w pasie wspólnym (pierwsza mapa — odniesienie)
        dot = wagi > 0
        wsp = jest & dot
        k = 1.0
        if wsp.sum() > 50:
            sr = suma[wsp] / wagi[wsp, None]
            k = float(np.median(sr.sum(1) / np.maximum(prof[wsp].sum(1), 1e-6)))
        prof = prof * k
        print(f'  OPAL {rok}: {ok.sum()} wierszy, φc {latc[ok].min():.1f}…{latc[ok].max():.1f}, mnożnik {k:.3f}')
        suma[jest] += prof[jest]
        wagi[jest] += 1.0
    out = suma / np.maximum(wagi, 1e-9)[:, None]
    dane = wagi > 0
    for c in range(3):
        out[:, c] = np.interp(siatka, siatka[dane], out[dane, c])
    return siatka, out, dane


def paleta_lin(lat):
    pts = np.array([p[0] for p in PALETA])
    cols = np.stack([kolor(p[1]) for p in PALETA])
    return np.stack([np.interp(lat, pts, cols[:, c]) for c in range(3)], -1).astype(np.float32)


# ── Pole ścinania z profilu wiatru ─────────────────────────────────────────────
def wiatr(lat):
    w = np.asarray(SA['wind'], dtype=np.float64)
    x = (np.clip(lat, -90, 90) + 90) / SA['windStepDeg']
    return np.interp(x, np.arange(len(w)), w)


def scinanie(lat):
    """|dw/dφ| znormalizowane (0…1), wygładzone."""
    g = np.linspace(-90, 90, 3601)
    s = np.abs(np.gradient(wiatr(g), g))
    s = ndimage.gaussian_filter1d(s, 8)
    s /= s.max()
    return np.interp(lat, g, s).astype(np.float32)


def polygon_shape(lam, sides, lam0):
    """Lustro gasGiantAtmosphere.tsl.js polygonShapeCpu: r(λ) / r̄ wielokąta foremnego (średnia = 1)."""
    a = math.pi / sides
    mean = math.cos(a) * math.log(1 / math.cos(a) + math.tan(a)) / a
    x = np.mod(lam - lam0, 2 * a)
    return (math.cos(a) / np.cos(x - a) / mean).astype(np.float32)


def bump(x, c, w):
    return np.exp(-((x - c) / w) ** 2).astype(np.float32)


def kier(lat, lon, a, b):
    """Współrzędne szumu anizotropowego na kuli: równoleżnik × a (okresowe w długości), szerokość × b."""
    la, lo = lat * D2R, lon * D2R
    cl = np.cos(la)
    return (cl * np.cos(lo) * a).astype(np.float32), (cl * np.sin(lo) * a).astype(np.float32), (la * b).astype(np.float32)


def psi(lat, lon, ziarno):
    """Funkcja prądu wirów (dwie skale; wiry wydłużone wzdłuż równoleżników jak na Saturnie)."""
    x, y, z = kier(lat, lon, 7.0, 16.0)
    duze = fbm3(x, y, z, 1.0, 3, ziarno)
    x, y, z = kier(lat, lon, 20.0, 40.0)
    male = fbm3(x, y, z, 1.0, 2, ziarno + 5)
    return duze + 0.3 * male


def adwekcja(lat, lon, amp, ziarno, kroki=10):
    """Przesunięcie (szerokość, długość) wzdłuż pola bezźródłowego v = (∂ψ/∂x, −∂ψ/∂y) — kroki Eulera wstecz;
    `amp` [° na krok na jednostkę gradientu] — maska ścinania / burzy. Daje zwijające się włókna jak w płynie."""
    la = lat.astype(np.float64).copy()
    lo = lon.astype(np.float64).copy()
    e = 0.05
    for _ in range(kroki):
        cl = np.maximum(np.cos(la * D2R), 0.08)
        p0 = psi(la, lo, ziarno)
        dpy = (psi(la + e, lo, ziarno) - p0) / e                 # ∂ψ/∂φ [1/°]
        dpx = (psi(la, lo + e / cl, ziarno) - p0) / e            # ∂ψ/∂x (x — ° łuku na wschód)
        la = np.clip(la + amp * dpx, -89.9, 89.9)
        lo = lo - amp * dpy / cl
    return la, lo


# ── Mapa ───────────────────────────────────────────────────────────────────────
def generuj(W, H, ziarno=7):
    t0 = time.time()
    print('profil OPAL…')
    p_lat, p_rgb, p_dane = profil_opal()
    p_lum = p_rgb @ np.array([0.2126, 0.7152, 0.0722])
    krok = p_lat[1] - p_lat[0]
    sm = ndimage.gaussian_filter1d(p_lum, 3.0 / krok)
    struktura = np.clip((p_lum - sm) / np.maximum(sm, 1e-4) * 2.4 * np.where(p_lat < -8, 1.45, 1.0), -0.45, 0.45)
    struktura *= p_dane                                           # bez danych (równik, bieguny) — sam szum
    sm2 = ndimage.gaussian_filter1d(p_lum, 9.0 / krok)
    obw = np.clip(sm / np.maximum(sm2, 1e-4), 0.7, 1.3) ** 0.7
    obw = np.where(p_dane, obw, 1.0)
    # drobne pasy syntetyczne (równik bez danych OPAL, wszędzie dodatkowo słabo)
    rng0 = np.random.default_rng(ziarno + 99)
    syn = ndimage.gaussian_filter1d(rng0.normal(0, 1, len(p_lat)), 0.25 / krok)
    syn /= np.abs(syn).max()
    syn *= np.where(np.abs(p_lat) < OPAL_BEZ_ROWNIKA + 2, 0.10, 0.04)

    hexa = SA['hexagon']
    pol_n = SA['poles']['north']
    pol_s = SA['poles']['south']
    storm = SA['storm']
    ribbon = SA['ribbon']
    hexT = (90.0 - hexa['latC']) * D2R
    lam0 = hexa['phaseU'] * D2R

    # 1) adwekcja wirów na siatce zgrubnej (pole gładkie) → przesunięcia na pełną rozdzielczość
    Wc = min(W, 2048)
    Hc = Wc // 2
    print(f'adwekcja wirów ({Wc} × {Hc})…')
    latc_ = (90.0 - (np.arange(Hc) + 0.5) / Hc * 180.0)[:, None] * np.ones((1, Wc))
    lonc_ = np.ones((Hc, 1)) * ((np.arange(Wc) + 0.5) / Wc * 360.0 - 180.0)[None, :]
    sh = scinanie(latc_)
    w_burza_c = smoothstep(storm['lo'], storm['lo'] + 3, latc_) * (1 - smoothstep(storm['hi'] - 3, storm['hi'], latc_))
    biegun = smoothstep(74.0, 66.0, np.abs(latc_))               # czapy mają własne struktury
    amp = (0.25 + 1.6 * sh + 1.5 * w_burza_c) * biegun * 1.3
    la_a, lo_a = adwekcja(latc_, lonc_, amp, ziarno + 3)
    dlat_c = (la_a - latc_).astype(np.float32)
    dlon_c = (((lo_a - lonc_) + 180) % 360 - 180).astype(np.float32)
    print(f'  ({time.time() - t0:.0f} s)')

    def wzwiekszone(a):
        if Wc == W:
            return a
        pad = np.concatenate([a[:, -2:], a, a[:, :2]], axis=1)
        z = ndimage.zoom(pad, W / Wc, order=1)
        o = int(round(2 * W / Wc))
        return z[:H, o:o + W]
    dlat_f = wzwiekszone(dlat_c)
    dlon_f = wzwiekszone(dlon_c)

    rgb = np.zeros((H, W, 3), dtype=np.float32)
    lon1 = ((np.arange(W) + 0.5) / W * 360.0 - 180.0).astype(np.float64)
    lam1 = ((np.arange(W) + 0.5) / W * 2 * math.pi).astype(np.float64)   # u · 2π (jak shader)
    for j0, j1 in pasy(H, 128):
        lat = (90.0 - (np.arange(j0, j1) + 0.5) / H * 180.0)[:, None] * np.ones((1, W))
        lon = np.ones((j1 - j0, 1)) * lon1[None, :]
        lam = np.ones((j1 - j0, 1)) * lam1[None, :]
        shear = scinanie(lat)
        theta_n = (90.0 - lat) * D2R
        theta_s = (90.0 + lat) * D2R
        # linie prądu wokół bieguna płn. (sześciokąt — jak shader)
        shape = polygon_shape(lam, hexa['sides'], lam0)
        wh = smoothstep(hexT - hexa['inner'] * D2R, hexT, theta_n) * (1 - smoothstep(hexT, hexT + hexa['outer'] * D2R, theta_n))
        rho_n = theta_n / (1 + (shape - 1) * wh)
        lat_s = np.where(theta_n < 25 * D2R, 90.0 - rho_n / D2R, lat)
        w_burza = smoothstep(storm['lo'], storm['lo'] + 3, lat) * (1 - smoothstep(storm['hi'] - 3, storm['hi'], lat))

        # położenie „źródłowe” po adwekcji (wiry) + długie fale granic pasów
        latw = lat_s + dlat_f[j0:j1]
        lonw = lon + dlon_f[j0:j1]
        x, y, z = kier(latw, lonw, 2.4, 10.0)
        fal = (fbm3(x, y, z, 1.0, 3, ziarno) - 0.5) * 2
        latw = np.clip(latw + fal * (0.25 + 0.5 * shear) * smoothstep(76.0, 68.0, np.abs(lat)), -89.99, 89.99)

        # 2) barwa pasa: paleta × jasność OPAL w szerokości źródłowej
        base = paleta_lin(latw)
        st = np.interp(latw, p_lat, struktura + syn).astype(np.float32)
        ob = np.interp(latw, p_lat, obw).astype(np.float32)
        col = base * ((1 + st) * ob)[..., None]

        # 3) smugi wzdłuż równoleżników — w położeniu źródłowym (zwijają się z wirami)
        x, y, z = kier(latw, lonw, 10.0, 300.0)
        s1 = fbm3(x, y, z, 1.0, 4, ziarno + 21)
        x, y, z = kier(latw, lonw, 34.0, 900.0)
        s2 = fbm3(x, y, z, 1.0, 3, ziarno + 22)
        smugi = (s1 - 0.5) * 0.22 + (s2 - 0.5) * 0.12
        col *= (1 + smugi * (0.7 + 0.9 * shear + 0.9 * w_burza))[..., None]

        # 4) pas burzy: włókna pomarańczowe i jasne (z adwekcji — znak przesunięcia), głowa konwekcyjna
        dl = ((lon - (storm['headU'] - 180.0) + 180.0) % 360.0) - 180.0   # 0 w głowie, + na wschód
        ogon = np.where(dl >= 0, 0.5 + 0.5 * np.exp(-dl / 120.0), 0.5 + 0.5 * np.exp(-(dl / 6.0) ** 2))
        x, y, z = kier(latw, lonw, 16.0, 60.0)
        tur = (fbm3(x, y, z, 1.0, 4, ziarno + 23) - 0.5) * 2
        ciem = np.clip(-tur * 1.6, 0, 1) ** 1.2 * w_burza * ogon
        jas = np.clip(tur * 1.6 - 0.2, 0, 1) ** 1.4 * w_burza * ogon
        col = col * (1 - 0.4 * ciem[..., None]) + kolor('#a5501f') * (0.4 * ciem)[..., None]
        col = col + kolor('#fff0d2') * (0.55 * jas)[..., None]
        glowa = np.where(dl >= 0, np.exp(-(dl / 22.0) ** 2), np.exp(-(dl / 3.0) ** 2)) * bump(lat, storm['headLat'], 2.4)
        x, y, z = kier(latw, lonw, 60.0, 120.0)
        kl = fbm3(x, y, z, 1.0, 4, ziarno + 31)
        chm = smoothstep(0.42, 0.62, kl) * glowa
        col = col * (1 - 0.75 * chm[..., None]) + kolor('#fffaf0') * (1.05 * chm)[..., None]

        # 5) fala wstęgowa 42° N: nieregularna ciemna wstęga z jasnym brzegiem płn.
        x, y, z = kier(lat, lon, 3.0, 4.0)
        fr = fbm3(x, y, z, 1.0, 2, ziarno + 41)
        fala = (ribbon['lat'] + ribbon['amp'] * (0.6 + 0.8 * fr) * np.sin(ribbon['waves'] * lon * D2R + 0.7 + 3.0 * fr)
                + dlat_f[j0:j1] * 0.6)
        d = lat - fala
        col *= (1 - 0.22 * bump(d, 0.0, 0.2))[..., None]
        col += kolor('#f6e2b8') * (0.10 * bump(d, 0.32, 0.18))[..., None]

        # 6) czapa płn.: pierścienie wzdłuż linii prądu, sześciokąt (jasny dżet, ciemny brzeg zewn.), wir polarny
        rn = rho_n / D2R
        hx = 90.0 - hexa['latC']
        cz = smoothstep(26.0, 17.0, rn)
        xr, yr = (np.cos(lam) * rn).astype(np.float32), (np.sin(lam) * rn).astype(np.float32)
        pier = fbm3(xr * 0.35, yr * 0.35, (rn * 3.2).astype(np.float32), 1.0, 4, ziarno + 51)
        pier2 = fbm3(xr * 1.4, yr * 1.4, (rn * 9.0).astype(np.float32), 1.0, 3, ziarno + 52)
        col *= (1 + ((pier - 0.5) * 0.55 + (pier2 - 0.5) * 0.25) * cz)[..., None]
        # spiralne smugi wiru polarnego (szum w układzie spirali logarytmicznej — wydłużony wzdłuż ramion)
        lnr = np.log(np.maximum(rn, 0.05))
        sp = lam - 1.8 * lnr
        sx_, sy_, sz_ = (np.cos(sp) * 2.2).astype(np.float32), (np.sin(sp) * 2.2).astype(np.float32), (lnr * 7.0).astype(np.float32)
        spn = fbm3(sx_, sy_, sz_, 1.0, 4, ziarno + 53)
        col *= (1 + (spn - 0.5) * 0.55 * smoothstep(0.8, 2.0, rn) * (1 - smoothstep(10.0, 16.0, rn)))[..., None]
        # sześciokąt: ciemniejsze wnętrze, pas chmur dżetu (szeroki, w smugach wzdłuż boków), ciemny brzeg zewn.
        wn = smoothstep(hx + 0.6, hx - 1.2, rn)
        col *= (1 - 0.16 * wn)[..., None]
        x6, y6, z6 = kier(90.0 - rn, lon, 30.0, 400.0)
        smuga6 = fbm3(x6, y6, z6, 1.0, 3, ziarno + 54)
        col += kolor('#c7dcf3') * (0.30 * bump(rn, hx - 0.25, 0.75) * (0.35 + 1.1 * smuga6))[..., None]
        col *= (1 - 0.22 * bump(rn, hx + 1.0, 0.8))[..., None]
        oko_n, sciana = pol_n['eye'], pol_n['eyewall']
        ram = 0.5 + 0.5 * np.cos(4 * lam - 5.5 * lnr + 3.0 * (pier2 - 0.5))
        spir = smoothstep(sciana * 0.9, sciana * 1.6, rn) * (1 - smoothstep(4.5, 9.0, rn))
        col *= (1 + (ram - 0.5) * 0.6 * spir)[..., None]
        lam_w = (spn - 0.5) * 2
        col += kolor('#dcedff') * (0.75 * bump(rn, sciana * (1 + 0.12 * lam_w), 0.3) * np.clip(0.2 + 1.2 * spn, 0, 1.4))[..., None]
        col += kolor('#a9c9ef') * (0.22 * bump(rn, sciana * 1.6, 0.3) * spn)[..., None]
        oko = 1 - smoothstep(oko_n * 0.55, oko_n, rn)
        col = col * (1 - oko[..., None]) + kolor('#1b3466') * (oko * (0.85 + 0.3 * pier2))[..., None]

        # 7) czapa płd.: pierścienie, wir polarny (oko, podwójna ściana, ramiona)
        rs = theta_s / D2R
        czs = smoothstep(26.0, 15.0, rs)
        xs_, ys_ = (np.cos(lam) * rs).astype(np.float32), (np.sin(lam) * rs).astype(np.float32)
        pier_s = fbm3(xs_ * 0.35, ys_ * 0.35, (rs * 3.0).astype(np.float32), 1.0, 4, ziarno + 61)
        pier_s2 = fbm3(xs_ * 1.4, ys_ * 1.4, (rs * 8.5).astype(np.float32), 1.0, 3, ziarno + 62)
        col *= (1 + ((pier_s - 0.5) * 0.5 + (pier_s2 - 0.5) * 0.22) * czs)[..., None]
        lns = np.log(np.maximum(rs, 0.05))
        sps = lam + 1.8 * lns
        sx_, sy_, sz_ = (np.cos(sps) * 2.2).astype(np.float32), (np.sin(sps) * 2.2).astype(np.float32), (lns * 7.0).astype(np.float32)
        spns = fbm3(sx_, sy_, sz_, 1.0, 4, ziarno + 63)
        col *= (1 + (spns - 0.5) * 0.6 * smoothstep(1.0, 2.5, rs) * (1 - smoothstep(11.0, 18.0, rs)))[..., None]
        ram_s = 0.5 + 0.5 * np.cos(3 * lam + 5.0 * lns + 3.0 * (pier_s2 - 0.5))
        spir_s = smoothstep(pol_s['eyewall'], pol_s['eyewall'] * 1.8, rs) * (1 - smoothstep(5.0, 10.0, rs))
        col *= (1 + (ram_s - 0.5) * 0.5 * spir_s)[..., None]
        col += kolor('#f2dfb8') * ((0.6 * bump(rs, pol_s['eyewall'] * (1 + 0.1 * (spns - 0.5) * 2), 0.32)
                                    + 0.25 * bump(rs, pol_s['eyewall'] * 1.45, 0.3)) * np.clip(0.2 + 1.2 * spns, 0, 1.4))[..., None]
        oko_s = 1 - smoothstep(pol_s['eye'] * 0.55, pol_s['eye'], rs)
        col = col * (1 - oko_s[..., None]) + kolor('#3b2f26') * oko_s[..., None]

        rgb[j0:j1] = col
        print(f'  wiersze {j0}–{j1} ({time.time() - t0:.0f} s)', end='\r')
    print()

    # 8) owale z danych (wiry obracane w grze): wypełnione, miękki brzeg, spirala w środku
    print('wiry i chmury…')
    rng = np.random.default_rng(ziarno)

    def owal(u_deg, lat0, a, b, rdzen, kolnierz, sila, spirala, zwrot):
        lon0 = u_deg - 180.0
        hh = int(b * 1.8 / 180 * H) + 2
        ww = int(a * 1.8 / 360 * W) + 2
        cj = int((90 - lat0) / 180 * H)
        ci = int((lon0 + 180) / 360 * W)
        jj = np.arange(cj - hh, cj + hh)
        jj = jj[(jj >= 0) & (jj < H)]
        ii = np.arange(ci - ww, ci + ww)
        J, I = np.meshgrid(jj, ii, indexing='ij')
        la = 90 - (J + 0.5) / H * 180
        lo = (I + 0.5) / W * 360 - 180
        X = ((lo - lon0 + 180) % 360 - 180) / a
        Y = (la - lat0) / b
        r = np.sqrt(X * X + Y * Y)
        ang = np.arctan2(Y, X)
        x3, y3, z3 = (np.cos(ang + zwrot * spirala * 3.2 * (1 - r)) * r * 3).astype(np.float32), \
            (np.sin(ang + zwrot * spirala * 3.2 * (1 - r)) * r * 3).astype(np.float32), (r * 2.0).astype(np.float32)
        sw = fbm3(x3, y3, z3, 1.0, 4, int(u_deg * 10) % 997)
        rd = 1 - smoothstep(0.35, 1.0, r)
        kol = bump(r, 0.88, 0.22)
        I2 = I % W
        c = rgb[J, I2]
        mix_r = (sila * rd * (0.75 + 0.5 * sw))[..., None]
        c = c * (1 - mix_r) + kolor(rdzen) * mix_r
        c = c + kolor(kolnierz) * (0.28 * sila * kol * (0.6 + 0.8 * sw))[..., None]
        rgb[J, I2] = c

    for v in SA['vortices']:
        zw = -1.0 if v['sense'] < 0 else 1.0
        if 'anticyklon' in v['id']:
            owal(v['u'], v['lat'], v['a'], v['b'], '#9a5427', '#ffe6bd', 0.55, 1.0, zw)
        elif 'alei' in v['id']:
            owal(v['u'], v['lat'], v['a'], v['b'], '#7a5233', '#fbe8c6', 0.5, 1.0, zw)
        else:
            owal(v['u'], v['lat'], v['a'], v['b'], '#f7ecd4', '#fff4e0', 0.55, 0.8, zw)

    # chmury konwekcyjne: jasne plamki (wydłużone wzdłuż równoleżnika), gęstość wg szerokości
    def gestosc(lat):
        return (0.2 + 1.7 * bump(lat, 64, 9) + 1.3 * bump(lat, 79, 6) + 0.7 * bump(lat, 46, 7) + 1.1 * bump(lat, -38, 3.5)
                + 0.45 * bump(lat, -56, 8) + 0.5 * bump(lat, 33, 4))
    n = int(11000 * (W / 8192) ** 0.5)
    lat_c_ = np.degrees(np.arcsin(rng.uniform(-1, 1, n * 4)))
    keep = rng.uniform(0, 3.6, n * 4) < gestosc(lat_c_)
    lat_c_ = lat_c_[keep][:n]
    lon_c_ = rng.uniform(-180, 180, len(lat_c_))
    sig = rng.uniform(0.04, 0.16, len(lat_c_))
    amp = rng.uniform(0.15, 0.7, len(lat_c_)) * rng.choice([1.0, 1.0, 1.0, -0.5], len(lat_c_))
    pole = np.zeros((H, W), dtype=np.float32)
    for la0, lo0, s0, a0 in zip(lat_c_, lon_c_, sig, amp):
        sx = s0 / max(math.cos(la0 * D2R), 0.08) * 1.8
        hh = int(s0 * 3 / 180 * H) + 1
        ww = min(W // 2, int(sx * 3 / 360 * W) + 1)
        cj = int((90 - la0) / 180 * H)
        ci = int((lo0 + 180) / 360 * W)
        jj = np.arange(max(0, cj - hh), min(H, cj + hh + 1))
        ii = np.arange(ci - ww, ci + ww + 1)
        if len(jj) == 0:
            continue
        la = 90 - (jj + 0.5) / H * 180
        lo = (ii + 0.5) / W * 360 - 180
        g = np.exp(-(((la - la0) / s0) ** 2))[:, None] * np.exp(-((((lo - lo0 + 180) % 360 - 180) / sx) ** 2))[None, :]
        pole[np.ix_(jj, ii % W)] += a0 * g
    pole = np.clip(pole, -0.6, 1.0)
    biel = kolor('#fffaf0')
    rgb = rgb * (1 - 0.6 * np.clip(pole, 0, 1)[..., None]) + biel * (0.6 * np.clip(pole, 0, 1))[..., None]
    rgb *= (1 + 0.3 * np.clip(pole, -1, 0))[..., None]
    print(f'gotowe ({time.time() - t0:.0f} s)')
    return np.clip(rgb, 0, 1)


def widok_biegun(srgb, W, H, polnoc=True, rozmiar=900, zasieg=32.0):
    """Biegun w rzucie azymutalnym (ocena sześciokąta i wirów): `zasieg` — ° od bieguna do brzegu kadru."""
    c = (np.arange(rozmiar) + 0.5) / rozmiar * 2 - 1
    X, Y = np.meshgrid(c, -c)
    r = np.sqrt(X * X + Y * Y) * zasieg
    lam = np.arctan2(Y, X) if polnoc else np.arctan2(-Y, X)
    lat = (90 - r) if polnoc else (r - 90)
    j = np.clip(((90 - lat) / 180 * H).astype(int), 0, H - 1)
    i = (np.mod(lam, 2 * math.pi) / (2 * math.pi) * W).astype(int) % W
    out = srgb[j, i]
    out[r > zasieg] = 0
    return out


def kadry(srgb, W, H):
    """Wycinki w natywnej rozdzielczości do oceny wyglądu (PODGLAD/saturn-kadr-*.png)."""
    def wyc(lon0, lon1, lat0, lat1):
        i0, i1 = int((lon0 + 180) / 360 * W), int((lon1 + 180) / 360 * W)
        j0, j1 = int((90 - lat1) / 180 * H), int((90 - lat0) / 180 * H)
        return srgb[j0:j1, i0:i1]
    st = SA['storm']
    lon_h = st['headU'] - 180
    podglad(os.path.join(PODGLAD, 'saturn-kadr-burza.png'), wyc(lon_h - 70, lon_h + 40, 18, 50), 1600)
    podglad(os.path.join(PODGLAD, 'saturn-kadr-rownik.png'), wyc(-60, 30, -22, 22), 1600)
    podglad(os.path.join(PODGLAD, 'saturn-kadr-aleja.png'), wyc(-150, -40, -55, -25), 1600)
    podglad(os.path.join(PODGLAD, 'saturn-kadr-biegunN.png'), widok_biegun(srgb, W, H, True), 900)
    podglad(os.path.join(PODGLAD, 'saturn-kadr-biegunS.png'), widok_biegun(srgb, W, H, False), 900)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--szer', type=int, default=2048)
    ap.add_argument('--do-gry', action='store_true', help='zapis do public/assets/planety/solar/saturn/')
    ap.add_argument('--ziarno', type=int, default=7)
    ap.add_argument('--kadry', action='store_true', help='wycinki do oceny (burza, równik, biegun płn.)')
    args = ap.parse_args()
    W = args.szer
    H = W // 2
    rgb = generuj(W, H, args.ziarno)
    srgb = lin_do_srgb(rgb)
    os.makedirs(PODGLAD, exist_ok=True)
    podglad(os.path.join(PODGLAD, f'saturn-{W}.png'), srgb, 2048)
    if args.kadry:
        kadry(srgb, W, H)
    # bieguny z bliska (azymutalnie) — do oceny czap
    if args.do_gry:
        os.makedirs(os.path.dirname(WYJSCIE), exist_ok=True)
        zapisz_rgb(WYJSCIE, srgb, 92)
        print('zapis', WYJSCIE)
    else:
        zapisz_rgb(os.path.join(PODGLAD, f'saturn-{W}.jpg'), srgb, 92)


if __name__ == '__main__':
    main()
