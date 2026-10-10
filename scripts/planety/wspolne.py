# -*- coding: utf-8 -*-
"""Wspólne narzędzia generatora map planet (scripts/planety/).

Mapy gry są równoodległe (equirect): kolumna 0 = 180° W, wiersz 0 = biegun północny,
piksel liczony w środku. Każdy szum liczony jest z KIERUNKU 3D na kuli — bez szwu
na 180° i bez ściśniętych biegunów. Duże tablice idą pasami wierszy (`pasy`), żeby
8192 × 4096 mieściło się w pamięci z zapasem.
"""
import json
import math
import os
import re
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

KATALOG_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
KATALOG_DANYCH = os.path.join(KATALOG_REPO, '.tmp', 'planety-dane')


# ── Siatka ─────────────────────────────────────────────────────────────────────
def siatka_katow(W, H, j0=0, j1=None):
    """Długość i szerokość geograficzna (radiany) środków pikseli wierszy [j0, j1)."""
    j1 = H if j1 is None else j1
    lon = (np.arange(W, dtype=np.float64) + 0.5) / W * 2.0 * np.pi - np.pi
    lat = np.pi / 2 - (np.arange(j0, j1, dtype=np.float64) + 0.5) / H * np.pi
    return np.meshgrid(lon, lat)


def kierunki(W, H, j0=0, j1=None):
    """Kierunek jednostkowy (x, y, z) pikseli: z = północ, x = (0°, 0°), y = 90° E."""
    lon, lat = siatka_katow(W, H, j0, j1)
    cl = np.cos(lat)
    return (cl * np.cos(lon)).astype(np.float32), (cl * np.sin(lon)).astype(np.float32), np.sin(lat).astype(np.float32)


def pasy(H, krok=256):
    for j0 in range(0, H, krok):
        yield j0, min(H, j0 + krok)


def kierunek_z_lonlat(lon_deg, lat_deg):
    lo, la = math.radians(lon_deg), math.radians(lat_deg)
    return np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])


# ── Szum 3D (wartości w węzłach kraty, hasz u32) ────────────────────────────────
_M1 = np.uint32(0x9E3779B1)
_M2 = np.uint32(0x85EBCA77)
_M3 = np.uint32(0xC2B2AE3D)


def _hasz(ix, iy, iz, ziarno):
    h = (ix.astype(np.uint32) * _M1) ^ (iy.astype(np.uint32) * _M2) ^ (iz.astype(np.uint32) * _M3) ^ np.uint32(ziarno * 2654435761 & 0xFFFFFFFF)
    h ^= h >> np.uint32(15)
    h *= np.uint32(0x2C1B3C6D)
    h ^= h >> np.uint32(12)
    h *= np.uint32(0x297A2D39)
    h ^= h >> np.uint32(15)
    return h.astype(np.float32) * np.float32(1.0 / 4294967295.0)


def szum3(x, y, z, ziarno=0):
    """Szum wartości 3D w [0, 1], interpolacja kwintyczna."""
    fx, fy, fz = np.floor(x), np.floor(y), np.floor(z)
    ix, iy, iz = fx.astype(np.int64), fy.astype(np.int64), fz.astype(np.int64)
    tx, ty, tz = x - fx, y - fy, z - fz
    tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10)
    ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10)
    tz = tz * tz * tz * (tz * (tz * 6 - 15) + 10)
    out = None
    for dz in (0, 1):
        wz = tz if dz else (1 - tz)
        for dy in (0, 1):
            wy = ty if dy else (1 - ty)
            for dx in (0, 1):
                wx = tx if dx else (1 - tx)
                v = _hasz(ix + dx, iy + dy, iz + dz, ziarno) * (wx * wy * wz)
                out = v if out is None else out + v
    return out.astype(np.float32)


def fbm3(x, y, z, skala, oktawy=5, ziarno=0, lakunarnosc=2.03, zysk=0.5):
    """Suma oktaw szumu w [0, 1] (średnio ~0,5)."""
    acc = np.zeros_like(x, dtype=np.float32)
    amp, norm, s = 1.0, 0.0, skala
    for o in range(oktawy):
        acc += amp * szum3(x * s + 17.3 * o, y * s - 9.1 * o, z * s + 4.7 * o, ziarno + 101 * o)
        norm += amp
        amp *= zysk
        s *= lakunarnosc
    return acc / norm


def grzbiet3(x, y, z, skala, oktawy=4, ziarno=0):
    """Szum „grzbietowy” w [0, 1] — linie (szczeliny, koryta, żyły)."""
    acc = np.zeros_like(x, dtype=np.float32)
    amp, norm, s = 1.0, 0.0, skala
    for o in range(oktawy):
        n = szum3(x * s + 31.1 * o, y * s + 7.7 * o, z * s - 13.3 * o, ziarno + 211 * o)
        acc += amp * (1.0 - np.abs(n * 2.0 - 1.0)) ** 2
        norm += amp
        amp *= 0.5
        s *= 2.1
    return acc / norm


def pole_szumu(W, H, fn, krok=256):
    """Wywołuje fn(x, y, z) pasami i składa wynik (W × H, float32)."""
    out = np.empty((H, W), dtype=np.float32)
    for j0, j1 in pasy(H, krok):
        x, y, z = kierunki(W, H, j0, j1)
        out[j0:j1] = fn(x, y, z)
    return out


# ── Przetwarzanie map ──────────────────────────────────────────────────────────
def przeskaluj(a, W, H, filtr=Image.LANCZOS):
    """Tablica float32 → (H, W) filtrem PIL (tryb F)."""
    return np.asarray(Image.fromarray(np.ascontiguousarray(a, dtype=np.float32), mode='F').resize((W, H), filtr), dtype=np.float32)


def rozmyj_kula(a, sigma_px):
    """Rozmycie gaussowskie mapy równoodległej z zawinięciem w długości (szerokość: odbicie)."""
    from scipy.ndimage import gaussian_filter1d
    b = gaussian_filter1d(a, sigma_px, axis=0, mode='nearest')
    return gaussian_filter1d(b, sigma_px, axis=1, mode='wrap')


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def mix(a, b, t):
    t = np.asarray(t, dtype=np.float32)
    if a.ndim == 3 and t.ndim == 2:
        t = t[..., None]
    return a + (b - a) * t


def srgb_do_lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin_do_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float32), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(np.float32)


def kolor(hex_or_rgb):
    """Barwa sRGB (#rrggbb albo krotka 0–255) → liniowa (3,) float32."""
    if isinstance(hex_or_rgb, str):
        h = hex_or_rgb.lstrip('#')
        rgb = [int(h[i:i + 2], 16) for i in (0, 2, 4)]
    else:
        rgb = list(hex_or_rgb)
    return srgb_do_lin(np.array(rgb, dtype=np.float32) / 255.0)


def luminancja(lin):
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def wczytaj_obraz(sciezka, W=None, H=None, liniowo=True):
    """Obraz → float32 RGB (liniowy przy liniowo=True), opcjonalnie przeskalowany."""
    im = Image.open(sciezka).convert('RGB')
    if W and H and im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    a = np.asarray(im, dtype=np.float32) / 255.0
    return srgb_do_lin(a) if liniowo else a


def wczytaj_szary(sciezka, W=None, H=None):
    im = Image.open(sciezka).convert('L')
    if W and H and im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


# ── Mapa normalnych ────────────────────────────────────────────────────────────
def normalne_z_wysokosci(h_m, promien_m, przewyzszenie=1.0):
    """Mapa wysokości (m, równoodległa) → normalne w układzie stycznym (wschód, północ, w górę).

    R = wschód, G = północ (obraz w górę), B = w górę — jak dotychczasowa earth_normal.jpg
    (shader planet: S = ∂p/∂u, T = ∂p/∂v, v rośnie ku północy)."""
    H, W = h_m.shape
    lat = np.pi / 2 - (np.arange(H, dtype=np.float32) + 0.5) / H * np.pi
    dx = (promien_m * np.maximum(np.cos(lat), 0.02) * (2 * np.pi / W)).astype(np.float32)[:, None]
    dy = np.float32(promien_m * np.pi / H)
    hx = (np.roll(h_m, -1, axis=1) - np.roll(h_m, 1, axis=1)) / (2.0 * dx)
    hn = np.empty_like(h_m)
    hn[1:-1] = (h_m[:-2] - h_m[2:]) / (2.0 * dy)          # wiersz j−1 leży na północ od j
    hn[0] = hn[1]
    hn[-1] = hn[-2]
    nx = -hx * przewyzszenie
    ny = -hn * przewyzszenie
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + 1.0)
    return np.stack([nx * inv, ny * inv, inv], axis=-1).astype(np.float32)


# ── Zapis ──────────────────────────────────────────────────────────────────────
def zapisz_rgb(sciezka, rgb01, jakosc=92):
    """Zapis RGB w [0, 1] (już w przestrzeni pliku, np. sRGB) → JPEG/PNG/WebP wg rozszerzenia."""
    os.makedirs(os.path.dirname(sciezka), exist_ok=True)
    a = np.clip(np.asarray(rgb01, dtype=np.float32) * 255.0 + 0.5, 0, 255).astype(np.uint8)
    im = Image.fromarray(a, 'RGB' if a.ndim == 3 else 'L')
    ext = os.path.splitext(sciezka)[1].lower()
    if ext in ('.jpg', '.jpeg'):
        im.save(sciezka, quality=jakosc, subsampling=0 if jakosc >= 90 else 2, optimize=True)
    elif ext == '.webp':
        im.save(sciezka, quality=jakosc, method=6)
    else:
        im.save(sciezka, optimize=True)


def zapisz_normalne(sciezka, n, jakosc=95):
    zapisz_rgb(sciezka, n * 0.5 + 0.5, jakosc)


def podglad(sciezka, rgb01, szer=2048):
    """Mały podgląd do oglądania (PNG)."""
    a = np.clip(np.asarray(rgb01, dtype=np.float32) * 255.0 + 0.5, 0, 255).astype(np.uint8)
    im = Image.fromarray(a, 'RGB' if a.ndim == 3 else 'L')
    if im.size[0] > szer:
        im = im.resize((szer, max(1, int(im.size[1] * szer / im.size[0]))), Image.LANCZOS)
    os.makedirs(os.path.dirname(sciezka), exist_ok=True)
    im.save(sciezka)


# ── Parametry wspólne z grą ────────────────────────────────────────────────────
def wczytaj_json_z_js(sciezka_js, znacznik):
    """Blok JSON z modułu JS między komentarzami /*<znacznik>*/ … /*<znacznik>-KONIEC*/."""
    with open(sciezka_js, 'r', encoding='utf-8') as f:
        txt = f.read()
    m = re.search(r'/\*' + re.escape(znacznik) + r'\*/(.*?)/\*' + re.escape(znacznik) + r'-KONIEC\*/', txt, re.S)
    if not m:
        raise RuntimeError(f'brak bloku {znacznik} w {sciezka_js}')
    return json.loads(m.group(1))
