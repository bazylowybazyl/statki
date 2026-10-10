# -*- coding: utf-8 -*-
"""Mapa Jowisza gry z mozaiki Cassini (NASA/JPL/Space Science Institute, PIA07782).

Źródło: `.tmp/jowisz-dane/PIA07782.tif` — cylindryczna mapa barwna z kamery wąskokątnej Cassini
(11–12 XII 2000), 3601 × 1801 px, 0,1°/px, szerokość PLANETOCENTRYCZNA, bezstratny TIFF. Domena
publiczna (zdjęcia NASA/JPL bez prawa autorskiego, wzmianka o źródle mile widziana). Pobranie:
  curl -L -o .tmp/jowisz-dane/PIA07782.tif \
    https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia07/pia07782/PIA07782.tif

Dawna mapa gry (`jupiter_color.jpg`, 4096 × 2048) to ta sama mozaika — przeskalowana, cieplejsza
barwą i stratnie skompresowana (miękka). Tu: ostra mozaika z TIFF-u, wyrównana do dawnej mapy
(przesunięcie z korelacji — Wielka Czerwona Plama w tym samym miejscu tekstury), barwy dopasowane
do dawnej mapy (afiniczne przekształcenie RGB metodą najmniejszych kwadratów — wygląd gry bez
zmian), bieguny bez danych Cassini (N > 88,5°, S < −81°) z dawnej mapy.

Wynik: `public/assets/planety/solar/jupiter/jupiter_cassini_color.jpg` (4096 × 2048, kolumna 0 jak
w dawnej mapie, wiersz 0 = biegun N, szerokość planetocentryczna liniowo). Animację atmosfery liczy
gra (src/3d/jupiterAtmosphere*.js); położenia wirów (`JUPITER_VORTICES`) mierzone na tej mapie.

  .tmp/venv-planety/Scripts/python -I scripts/planety/jowisz.py [--podglad]
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wspolne import KATALOG_REPO, smoothstep  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
ZRODLO = os.path.join(KATALOG_REPO, '.tmp', 'jowisz-dane', 'PIA07782.tif')
DAWNA = os.path.join(KATALOG_REPO, 'public', 'assets', 'planety', 'solar', 'jupiter', 'jupiter_color.jpg')
WYJSCIE = os.path.join(KATALOG_REPO, 'public', 'assets', 'planety', 'solar', 'jupiter', 'jupiter_cassini_color.jpg')
PODGLAD = os.path.join(KATALOG_REPO, '.tmp', 'jowisz-dane')
W, H = 4096, 2048
# Pas danych Cassini (dalej wiersze stałe): północ do ~88,5°, południe do ~−81°.
DANE_N = (86.5, 88.0)
DANE_S = (-79.0, -80.5)


def probkuj(zrodlo, du, dv, W, H):
    """Mozaika (0,1°/px, piksele w węzłach siatki: kolumna i ↔ λ = 0,1·i, wiersz j ↔ φ = 90 − 0,1·j)
    w siatce gry W × H (środki pikseli), przesunięta o (du, dv) w uv. Bikubicznie, zawinięcie w długości."""
    Hs, Ws = zrodlo.shape[:2]
    per = Ws - 1  # kolumna 3600 = kolumna 0
    u = (np.arange(W, dtype=np.float64) + 0.5) / W + du
    v = (np.arange(H, dtype=np.float64) + 0.5) / H + dv
    col = np.mod(u * per, per)
    row = np.clip(v * (Hs - 1), 0, Hs - 1)
    rr, cc = np.meshgrid(row, col, indexing='ij')
    out = np.empty((H, W, zrodlo.shape[2]), np.float32)
    ext = np.concatenate([zrodlo[:, :per], zrodlo[:, :3]], axis=1)  # zapas na zawinięcie (bikubiczna)
    for k in range(zrodlo.shape[2]):
        out[..., k] = ndimage.map_coordinates(ext[..., k], [rr, cc], order=3, mode='nearest')
    return out


def przesuniecie(a, b):
    """(du, dv) takie, że a(u + du, v + dv) ≈ b(u, v) — korelacja fazowa luminancji pasa |φ| < 60°."""
    def luma(x):
        return x[..., 0] * 0.299 + x[..., 1] * 0.587 + x[..., 2] * 0.114
    la, lb = luma(a), luma(b)
    h = la.shape[0]
    j0, j1 = int(h * 30 / 180), int(h * 150 / 180)
    la = la[j0:j1] - la[j0:j1].mean()
    lb = lb[j0:j1] - lb[j0:j1].mean()
    win = np.hanning(la.shape[0])[:, None]
    fa, fb = np.fft.fft2(la * win), np.fft.fft2(lb * win)
    r = fa * np.conj(fb)
    r /= np.abs(r) + 1e-9
    c = np.fft.fftshift(np.fft.ifft2(r).real)
    # szczyt tylko blisko zera (±2,5°) — w pełnej rozdzielczości szum JPEG-a daje fałszywe szczyty dalej
    cy, cx = c.shape[0] // 2, c.shape[1] // 2
    ry, rx = max(2, int(c.shape[0] * 2.5 / 120)), max(2, int(c.shape[1] * 2.5 / 360))
    okno = c[cy - ry:cy + ry + 1, cx - rx:cx + rx + 1]
    j, i = np.unravel_index(np.argmax(okno), okno.shape)
    # dokładność podpikselowa: parabola przez sąsiadów szczytu
    def para(m1, m0, p1):
        d = m1 - 2 * m0 + p1
        return 0.0 if abs(d) < 1e-12 else 0.5 * (m1 - p1) / d
    fj = para(okno[j - 1, i], okno[j, i], okno[j + 1, i]) if 0 < j < okno.shape[0] - 1 else 0.0
    fi = para(okno[j, i - 1], okno[j, i], okno[j, i + 1]) if 0 < i < okno.shape[1] - 1 else 0.0
    return (i - rx + fi) / la.shape[1], (j - ry + fj) / h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--podglad', action='store_true', help='tylko podgląd 2048 px w .tmp/jowisz-dane')
    ap.add_argument('--jakosc', type=int, default=93)
    ap.add_argument('--ostrosc', type=float, default=0.9, help='maska nieostra, sigma 1,6 px')
    ap.add_argument('--kontrast', type=float, default=0.35, help='lokalny kontrast, sigma 24 px')
    ap.add_argument('--pasy-sigma', type=float, default=6.0, help='wygładzenie statystyk wierszy (px szerokości)')
    arg = ap.parse_args()
    zrodlo = np.asarray(Image.open(ZRODLO).convert('RGB')).astype(np.float32) / 255.0
    dawna = np.asarray(Image.open(DAWNA).convert('RGB')).astype(np.float32) / 255.0
    print('Cassini', zrodlo.shape, 'dawna', dawna.shape)

    # 1) Wyrównanie do dawnej mapy: zgrubnie na 1024 × 512, potem dokładnie na 4096 × 2048 wokół wyniku.
    du, dv = 0.0, 0.0
    for (w, h) in ((1024, 512), (4096, 2048)):
        a = probkuj(zrodlo, du, dv, w, h)
        b = np.asarray(Image.fromarray((dawna * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)).astype(np.float32) / 255.0
        ddu, ddv = przesuniecie(a, b)
        du += ddu
        dv += ddv
        print(f'  {w}×{h}: przesunięcie du={du * 360:+.3f}°, dv={dv * 180:+.3f}°')

    mapa = probkuj(zrodlo, du, dv, W, H)
    lat = 90.0 - (np.arange(H) + 0.5) / H * 180.0
    # Wyostrzenie: mozaika 0,1°/px przeskalowana do 4096 jest miękka (dawna mapa była wyostrzona) —
    # maska nieostra drobna (detal chmur) + szeroka (lokalny kontrast pasów).
    for sigma, ile in ((1.6, arg.ostrosc), (24.0, arg.kontrast)):
        if ile <= 0:
            continue
        rozm = np.stack([ndimage.gaussian_filter(mapa[..., k], sigma, mode=('nearest', 'wrap')) for k in range(3)], axis=-1)
        mapa = mapa + (mapa - rozm) * ile

    # 2) Barwy dawnej mapy PASAMI SZEROKOŚCI: w każdym wierszu średnia i rozrzut kanału jak w dawnej mapie
    #    (statystyki wierszy wygładzone wzdłuż szerokości). Obie mapy mają te same pasy, ale nie te same
    #    szczegóły (dawna jest z innego przetworzenia — inne plamy w NEB), a związek barw zależy od pasa —
    #    jedna krzywa na całą mapę dawała błotnisty NEB i beżową północ.
    pas = (lat > -70) & (lat < 70)
    print(f'  różnica z dawną mapą przed barwami (RMS): {np.sqrt(np.mean((mapa[pas] - dawna[pas]) ** 2)) * 255:.2f} / 255')
    sig = arg.pasy_sigma
    for k in range(3):
        mc = ndimage.gaussian_filter1d(mapa[..., k].mean(axis=1), sig, mode='nearest')
        mo = ndimage.gaussian_filter1d(dawna[..., k].mean(axis=1), sig, mode='nearest')
        sc = np.sqrt(ndimage.gaussian_filter1d(mapa[..., k].var(axis=1), sig, mode='nearest'))
        so = np.sqrt(ndimage.gaussian_filter1d(dawna[..., k].var(axis=1), sig, mode='nearest'))
        g = np.clip(so / np.maximum(sc, 1e-4), 0.6, 1.8)
        mapa[..., k] = (mapa[..., k] - mc[:, None]) * g[:, None] + mo[:, None]
    print(f'  różnica z dawną mapą po barwach (RMS): {np.sqrt(np.mean((mapa[pas] - dawna[pas]) ** 2)) * 255:.2f} / 255')
    mapa = np.clip(mapa, 0.0, 1.0)

    # 3) Bieguny bez danych Cassini — z dawnej mapy (miękkie przejście).
    wN = smoothstep(DANE_N[0], DANE_N[1], lat)
    wS = 1.0 - smoothstep(DANE_S[1], DANE_S[0], lat)
    w = np.maximum(wN, wS)[:, None, None].astype(np.float32)
    mapa = mapa * (1.0 - w) + dawna * w

    out = Image.fromarray(np.round(mapa * 255.0).astype(np.uint8))
    os.makedirs(PODGLAD, exist_ok=True)
    out.resize((2048, 1024), Image.LANCZOS).save(os.path.join(PODGLAD, 'podglad-cassini.png'))
    if arg.podglad:
        print('podgląd →', os.path.join(PODGLAD, 'podglad-cassini.png'))
        return
    out.save(WYJSCIE, quality=arg.jakosc, subsampling=0, optimize=True)
    print('mapa →', WYJSCIE, os.path.getsize(WYJSCIE) // 1024, 'kB')


if __name__ == '__main__':
    main()
